// Every docgen HTTP route lives here. Registered from index.js with two lines, so the rest of
// the server is untouched by this feature.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { store } from "../store.js";
import { docgenStore } from "../store/docgen.js";
import { enabledAccounts, fetchUsage } from "../accounts.js";
import { killChild } from "../runner.js";
import { listStandards, getStandard, publicStandard, composeStandard, listComposableDocs }
  from "../docgen/standards/index.js";
import { runSurvey } from "../docgen/survey.js";
import { ensureClaudeOnPath } from "../docgen/claudeBin.js";
import { buildPlan, mergeRevision, planToPreset, applyPreset, planStats } from "../docgen/plan.js";
import { estimateSurvey, estimateRevise, estimatePlan, estimateSection, windowsOf } from "../docgen/estimate.js";
import { gitAuthors, scanPreview } from "../docgen/gitscan.js";
import { TONES } from "../docgen/tones.js";
import { createWriteRun, pendingSections, ENGINES, headCommit } from "../docgen/write.js";
import { normalizeSection, sectionMetrics, jobMetrics } from "../docgen/ir.js";
import { detectStale, applyStale } from "../docgen/stale.js";
import { detectPython, forgetPython, renderDocx } from "../docgen/exporter.js";
import { ensureDemoProject, DEMO_NAME } from "../docgen/demo.js";
import { economyOf, capTargets, priceFactor } from "../docgen/economy.js";
import { destCandidates, gitIgnoreStatus, ensureDir, dirInfo, revealDir } from "../docgen/dests.js";
import * as runlog from "../docgen/runlog.js";

const pexecFile = promisify(execFile);

// Surveys currently running, so they can be stopped and so a second start is refused.
const running = new Map(); // jobId -> { child, startedAt }
// Write runs currently in flight. Separate from `running` because a write run is a controller
// (many sessions, switchable engine), not a single child process.
const writes = new Map();  // jobId -> WriteRun

const bad = (res, code, msg) => res.status(code).json({ error: msg });

// Which account a docgen session runs on: the preferred one when it is still enabled,
// otherwise the first enabled account. Mirrors what the session manager does.
function accountFor() {
  const list = enabledAccounts();
  const preferred = store.getSettings().preferredAccount;
  return list.find((a) => a.id === preferred) || list[0] || null;
}

// Native file dialog for picking a Word template, per platform. Returns null when cancelled.
async function pickDocxNative() {
  const title = "Chọn mẫu Word (.docx)";
  if (process.platform === "win32") {
    const ps = "Add-Type -AssemblyName System.Windows.Forms | Out-Null; "
      + "$d = New-Object System.Windows.Forms.OpenFileDialog; "
      + `$d.Title = "${title}"; $d.Filter = "Word document (*.docx)|*.docx"; `
      + "if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.FileName) }";
    const { stdout } = await pexecFile("powershell.exe", ["-NoProfile", "-STA", "-Command", ps], { windowsHide: true });
    return stdout.trim() || null;
  }
  if (process.platform === "darwin") {
    const script = `POSIX path of (choose file with prompt "${title}" of type {"docx"})`;
    try { const { stdout } = await pexecFile("osascript", ["-e", script]); return stdout.trim() || null; }
    catch { return null; } // cancel
  }
  for (const [cmd, args] of [
    ["zenity", ["--file-selection", `--title=${title}`, "--file-filter=*.docx"]],
    ["kdialog", ["--getopenfilename", ".", "*.docx"]],
  ]) {
    try { const { stdout } = await pexecFile(cmd, args); return stdout.trim() || null; }
    catch (e) { if (e.code === "ENOENT") continue; return null; }
  }
  throw new Error("Không có hộp thoại chọn tệp (cài zenity/kdialog) — nhập đường dẫn thủ công.");
}

// A job either points at a declared standard, or carries the picks of a custom set.
function standardFor(job) {
  if (!job) return null;
  return job.standardId === "custom" ? composeStandard(job.customDocs || []) : getStandard(job.standardId);
}

export function registerDocRoutes(app, broadcast = () => {}) {
  const emit = (job, extra = {}) => broadcast({ type: "doc:job", jobId: job.id, job, ...extra });

  // Project mẫu `stale-demo`: dựng lúc boot nếu chưa có, và seed dữ liệu mẫu nếu nó chưa có bộ
  // tài liệu nào. Chạy ở đây (không phải index.js) để feature docgen tự lo phần khởi tạo của mình.
  //
  // Không đồng bộ vì seed.js được nạp động — nhưng cũng không ai phải chờ: các route dưới đã đăng
  // ký xong trước khi phần này chạy, và lần gọi API đầu tiên của UI luôn tới sau đó.
  (async () => {
    try {
      const boot = ensureDemoProject(store, docgenStore);
      if (boot.files?.created) console.log(`[docgen] đã dựng repo mẫu tại ${boot.files.path}`);
      if (boot.action === "created") console.log(`[docgen] đã tạo project mẫu “${DEMO_NAME}”`);
      if (boot.action === "repathed")
        console.log(`[docgen] project “${DEMO_NAME}” trỏ vào thư mục không còn tồn tại `
          + `(${boot.from}) — đã trỏ lại về ${boot.project?.repo_path}`);
      if (boot.seeded === "pending" && boot.project) {
        const { seedDocgen } = await import("../docgen/seed.js");
        const out = seedDocgen(boot.project);
        console.log(`[docgen] đã seed ${out.jobs.length} bộ tài liệu mẫu vào project mẫu`);
        broadcast({ type: "doc:job", jobId: null, seeded: true });
      }
    } catch (e) {
      // Dựng project mẫu thất bại không được làm server không lên: mọi thứ khác vẫn chạy được.
      console.error("[docgen] không dựng được project mẫu: " + e.message);
    }
  })();

  // A survey or a write run that was interrupted by a restart is not "still running" — mark it so
  // the card offers "Tiếp tục" instead of a spinner that never ends (test cases 10 and 11).
  //
  // "Server đã restart" answers *what* happened, never *why*. The why is in run.log, which survived
  // the restart precisely for this: the last few real events go into `error.trace` so the UI can
  // show them without the user having to find the file. That gap is the ca-11 bug.
  for (const job of docgenStore.listJobs()) {
    const interrupted = job.status === "surveying" ? "khảo sát" : job.status === "writing" ? "viết" : null;
    if (!interrupted) continue;
    if (job.status === "writing") {
      // Sections that made it to the store are kept; the ones mid-flight go back to pending so
      // "Tiếp tục" picks up exactly those.
      const plan = docgenStore.getPlan(job.id);
      for (const d of plan?.docs || [])
        for (const s of d.sections || []) if (s.status === "writing")
          docgenStore.patchPlanSection(job.id, s.id, { status: "pending" });
    }
    let trace = [];
    try { trace = runlog.lastMeaningful(job.id, 8); } catch { /* chưa có log cho job này */ }
    const stage = job.status === "writing" ? "write" : "survey";
    const last = trace.at(-1);
    try {
      runlog.log(job.id, { stage, kind: "run-error",
        text: `■ server restart khi đang ${interrupted} — lượt này bị cắt`,
        detail: [`Tiến trình server kết thúc trong lúc job đang ở trạng thái "${job.status}".`,
          `Dòng cuối agent kịp phát: ${last ? `${last.kind} — ${last.text}` : "(không có, phiên chưa phát event nào)"}`,
          "",
          "Đây KHÔNG phải lỗi do Claude trả về: CLI bị kill cùng tiến trình cha nên không có mã thoát hay stderr nào.",
          "Muốn biết agent đang làm gì thì đọc các dòng ngay trên dòng này."]
          .join("\n") });
    } catch { /* ghi log lỗi thì cũng không được chặn việc đánh dấu job */ }
    docgenStore.patchJob(job.id, { status: "error",
      error: { kind: "interrupted",
        message: job.status === "writing"
          ? "Server khởi động lại khi đang viết — các mục đã viết vẫn còn, bấm Tiếp tục để viết nốt."
          : "Server khởi động lại khi đang khảo sát — bấm Tiếp tục để chạy lại.",
        // Vì sao không có lý do từ Claude: CLI chết cùng tiến trình cha, không kịp trả mã thoát.
        why: "Tiến trình server dừng giữa lượt chạy nên Claude CLI bị kill theo, không có mã thoát "
          + "hay stderr để báo. Mấy dòng cuối agent kịp phát nằm ở tab Console (hoặc tải log về).",
        lastActivity: last ? `${last.text}` : null,
        trace: trace.map((e) => ({ t: e.t, kind: e.kind, session: e.session, text: e.text })),
      } });
  }

  // ---- standards & presets (studio-wide) ----
  app.get("/api/doc-standards", (req, res) =>
    res.json({ standards: listStandards(), composable: listComposableDocs(), tones: TONES }));

  app.get("/api/doc-presets", (req, res) => res.json({ presets: docgenStore.listPresets() }));
  app.post("/api/doc-presets", (req, res) => {
    const { name, standardId, docs } = req.body || {};
    if (!name || !standardId) return bad(res, 400, "Cần tên preset và chuẩn");
    res.json({ preset: docgenStore.savePreset({ name, standardId, docs: docs || [] }) });
  });
  app.put("/api/doc-presets/:pid", (req, res) => {
    if (!docgenStore.getPreset(req.params.pid)) return bad(res, 404, "Không thấy preset");
    res.json({ preset: docgenStore.savePreset({ ...req.body, id: req.params.pid }) });
  });
  app.delete("/api/doc-presets/:pid", (req, res) => {
    if (!docgenStore.deletePreset(req.params.pid)) return bad(res, 404, "Không thấy preset");
    res.json({ ok: true });
  });

  // ---- studio-wide agent settings ----
  // The token threshold is NOT a docgen setting: it is the app-wide rule for "hỏi trước khi tiêu
  // hơn N token", and any feature that spends tokens should gate itself with the same number.
  // It lives in docgen.json only because D1 must not touch store.js; Cài đặt → Chung (D3) moves
  // the control there, reading the same endpoint.
  // `notes` (danh sách cái gì đang bị siết) đi kèm luôn, để client không phải tự suy lại từ các cờ
  // thô — suy hai nơi là hai nơi phải sửa khi thêm một nút tiết kiệm.
  const withEconomyNotes = (s) => ({ ...s, economy: { ...s.economy, notes: economyOf(s).notes } });

  app.get("/api/agent-settings", (req, res) => res.json(withEconomyNotes(docgenStore.getSettings())));
  app.put("/api/agent-settings", (req, res) => {
    const patch = {};
    if (req.body.tokenThreshold !== undefined)
      patch.tokenThreshold = Math.max(0, Number(req.body.tokenThreshold) || 0);
    if (req.body.tokensPer5h !== undefined)
      patch.tokensPer5h = Math.max(1000, Number(req.body.tokensPer5h) || 2000000);
    if (req.body.dontAsk && typeof req.body.dontAsk === "object") patch.dontAsk = req.body.dontAsk;
    // Global Word template: the fallback used by any document set that does not pick its own.
    if (typeof req.body.defaultTemplatePath === "string")
      patch.defaultTemplatePath = req.body.defaultTemplatePath.trim();
    // Economy mode. The store normalizes it, so a partial patch ({ on: false }) keeps the rest.
    if (req.body.economy && typeof req.body.economy === "object") patch.economy = req.body.economy;
    res.json(withEconomyNotes(docgenStore.setSettings(patch)));
  });

  // Native "choose a .docx" dialog. The app already has a folder picker; a document set needs a
  // file, and D1 must not add a route to index.js.
  app.get("/api/doc-scan/pick-docx", async (req, res) => {
    try { res.json({ path: await pickDocxNative() }); }
    catch (e) { res.status(400).json({ error: String(e.message), manual: true }); }
  });

  // ---- scope helpers used by the wizard ----
  app.get("/api/doc-scan/git-authors", async (req, res) => {
    const path = String(req.query.path || "");
    if (!path || !existsSync(path)) return bad(res, 400, "Đường dẫn không tồn tại");
    res.json(await gitAuthors(path));
  });

  app.get("/api/doc-scan/preview", async (req, res) => {
    const path = String(req.query.path || "");
    const authors = String(req.query.authors || "").split("|").filter(Boolean);
    res.json(await scanPreview({
      path, byAuthor: req.query.byAuthor === "1", authors,
      from: String(req.query.from || ""), to: String(req.query.to || ""),
    }));
  });

  // Sample data for inspecting the screens without paying for a survey. Going through the running
  // server (instead of the CLI script) is what keeps a second process from clobbering docgen.json.
  app.post("/api/projects/:id/doc-seed", async (req, res) => {
    const p = store.getProject(req.params.id);
    if (!p) return bad(res, 404, "Không thấy project");
    const { seedDocgen, clearSeed } = await import("../docgen/seed.js");
    if (req.query.clear === "1") {
      const r = clearSeed();
      broadcast({ type: "doc:job", jobId: null, seeded: true });
      return res.json({ ok: true, cleared: r });
    }
    const out = seedDocgen(p);
    broadcast({ type: "doc:job", jobId: null, seeded: true });
    res.json({ ok: true, ...out });
  });

  // ---- jobs ----
  app.get("/api/projects/:id/doc-jobs", (req, res) => {
    const p = store.getProject(req.params.id);
    if (!p) return bad(res, 404, "Không thấy project");
    const jobs = docgenStore.listJobs(p.id).map((j) => withPlanSummary(j));
    // Report a missing CLI here rather than letting the user find out two minutes into a survey.
    const cli = ensureClaudeOnPath();
    res.json({ jobs, storage: docgenStore.status(), cli: { ok: cli.ok, hint: cli.hint || null },
      economy: economyOf(docgenStore.getSettings()) });
  });

  app.post("/api/projects/:id/doc-jobs", (req, res) => {
    const p = store.getProject(req.params.id);
    if (!p) return bad(res, 404, "Không thấy project");
    const b = req.body || {};
    const picks = Array.isArray(b.customDocs) ? b.customDocs : [];
    const std = b.standardId === "custom" ? composeStandard(picks) : getStandard(b.standardId);
    if (!std || !std.docs.length)
      return bad(res, 400, b.standardId === "custom" ? "Chưa chọn tài liệu nào cho bộ tuỳ chọn" : "Chuẩn không hợp lệ");

    const job = docgenStore.createJob({
      projectId: p.id, projectName: p.name,
      name: b.name?.trim() || std.docs[0].title,
      standardId: std.id, customDocs: std.id === "custom" ? picks : undefined, status: "draft",
      // The main source is the project repo and stays locked (Q6). Anything else added here is a
      // reference document, never another body of source code: the code being documented is this
      // project's repo, by definition.
      sources: {
        main: { projectId: p.id, path: p.repo_path },
        extra: (b.sources?.extra || []).filter((e) => e?.path && existsSync(e.path))
          .map((e, i) => ({ id: "x" + i, kind: "reference", path: e.path })),
      },
      scope: {
        mode: b.scope?.mode === "feature" ? "feature" : "all",
        features: Array.isArray(b.scope?.features) ? b.scope.features : [],
        byAuthor: !!b.scope?.byAuthor,
        authors: Array.isArray(b.scope?.authors) ? b.scope.authors : [],
        from: b.scope?.from || "", to: b.scope?.to || "",
      },
      meta: {
        docIdPrefix: b.meta?.docIdPrefix || "", classification: b.meta?.classification || "Nội bộ",
        docStatus: b.meta?.docStatus || "Bản nháp", approvals: !!b.meta?.approvals,
        control: Array.isArray(b.meta?.control) ? b.meta.control : [],
        history: Array.isArray(b.meta?.history) ? b.meta.history : [],
      },
      style: {
        // templatePath set here wins; the global default in agent-settings is only a fallback.
        templateId: b.style?.templateId || null, templatePath: b.style?.templatePath || "",
        tone: b.style?.tone || "concise",
        outlineDepth: Math.min(3, Math.max(2, Number(b.style?.outlineDepth) || 2)),
        language: b.style?.language || "vi-keep-en", depth: b.style?.depth || "standard",
      },
      run: { engine: "per-doc" },
      metrics: { sections: 0, done: 0, tokens: 0, elapsedMs: 0 },
      sessionIds: [],
    });
    emit(job);
    res.json({ job: withPlanSummary(job) });
  });

  app.get("/api/doc-jobs/:jid", (req, res) => {
    const job = docgenStore.getJob(req.params.jid);
    if (!job) return bad(res, 404, "Không thấy bộ tài liệu");
    res.json({ job: withPlanSummary(job), plan: docgenStore.getPlan(job.id),
      standard: publicStandard(standardFor(job)) });
  });

  app.patch("/api/doc-jobs/:jid", (req, res) => {
    const job = docgenStore.getJob(req.params.jid);
    if (!job) return bad(res, 404, "Không thấy bộ tài liệu");
    const patch = {};
    for (const k of ["name", "scope", "meta", "style", "run"]) if (req.body[k] !== undefined) patch[k] = req.body[k];
    // Changing the engine while a run is in flight is a supported move (Q9): the live run drops
    // the sessions it no longer needs and restarts with whatever is still unwritten. Sections
    // already in the store are untouched, so no progress is lost.
    const nextEngine = req.body.run?.engine;
    let switched = false;
    if (nextEngine) {
      if (!ENGINES.includes(nextEngine)) return bad(res, 400, "Cách chạy không hợp lệ");
      const live = writes.get(job.id);
      if (live) switched = live.setEngine(nextEngine);
    }
    const next = docgenStore.patchJob(job.id, patch);
    emit(next);
    res.json({ job: withPlanSummary(next), switched });
  });

  app.delete("/api/doc-jobs/:jid", (req, res) => {
    const job = docgenStore.getJob(req.params.jid);
    if (!job) return bad(res, 404, "Không thấy bộ tài liệu");
    const live = running.get(job.id);
    if (live) { killChild(live.child); running.delete(job.id); }
    const run = writes.get(job.id);
    if (run) { run.stop(); writes.delete(job.id); }
    docgenStore.deleteJob(job.id);
    broadcast({ type: "doc:job", jobId: job.id, removed: true });
    res.json({ ok: true });
  });

  // ---- survey: draft -> surveying -> plan-review ----
  app.post("/api/doc-jobs/:jid/survey", (req, res) => {
    const job = docgenStore.getJob(req.params.jid);
    if (!job) return bad(res, 404, "Không thấy bộ tài liệu");
    if (running.has(job.id)) return bad(res, 409, "Bộ tài liệu này đang khảo sát");
    const std = standardFor(job);
    if (!std) return bad(res, 400, "Chuẩn không còn tồn tại");
    const project = store.getProject(job.projectId);
    if (!project || !existsSync(project.repo_path)) return bad(res, 400, "Không đọc được thư mục repo của project");
    const eco = economyOf(docgenStore.getSettings());
    if (eco.blockSurvey)
      return bad(res, 403, "Chế độ tiết kiệm đang chặn khảo sát (khoản đắt thứ hai sau viết). "
        + "Áp một preset để có dàn ý miễn phí, hoặc tắt “chặn khảo sát” trong cấu hình tiết kiệm.");
    const account = accountFor();
    if (!account) return bad(res, 400, "Chưa có account nào đang bật — thêm account rồi thử lại.");

    // "Tiếp tục" after a failed revision retries the revision, not a full survey — otherwise a
    // hiccup would throw away an outline the user has already been editing.
    const retryRevise = job.status === "error" && job.survey?.revise && docgenStore.getPlan(job.id)
      ? job.survey.revise : null;
    startSurvey({ job, std, project, account, revise: retryRevise });
    res.json({ ok: true, job: withPlanSummary(docgenStore.getJob(job.id)) });
  });

  // One "⏸ Dừng" button for both stages: whatever is running for this job stops.
  app.post("/api/doc-jobs/:jid/stop", (req, res) => {
    const run = writes.get(req.params.jid);
    if (run) { run.stop(); return res.json({ ok: true, stopped: "write" }); }
    const live = running.get(req.params.jid);
    if (!live) return bad(res, 404, "Không có phiên nào đang chạy");
    killChild(live.child);
    res.json({ ok: true, stopped: "survey" });
  });

  // ---- plan ----
  app.get("/api/doc-jobs/:jid/plan", (req, res) => {
    const job = docgenStore.getJob(req.params.jid);
    if (!job) return bad(res, 404, "Không thấy bộ tài liệu");
    const plan = docgenStore.getPlan(job.id);
    res.json({ plan, stats: plan ? planStats(plan, job.style?.depth) : null });
  });

  // The user's edits to the outline: reorder, rename, toggle, add. Frozen plans are read-only.
  app.put("/api/doc-jobs/:jid/plan", (req, res) => {
    const job = docgenStore.getJob(req.params.jid);
    if (!job) return bad(res, 404, "Không thấy bộ tài liệu");
    const cur = docgenStore.getPlan(job.id);
    if (cur?.approvedAt) return bad(res, 409, "Dàn ý đã duyệt và đóng băng — không sửa được nữa.");
    const incoming = req.body?.plan;
    if (!incoming?.docs) return bad(res, 400, "Thiếu dàn ý");
    const plan = docgenStore.putPlan(job.id, { ...cur, ...incoming, approvedAt: null });
    res.json({ plan, stats: planStats(plan, job.style?.depth) });
  });

  app.post("/api/doc-jobs/:jid/plan/approve", (req, res) => {
    const job = docgenStore.getJob(req.params.jid);
    if (!job) return bad(res, 404, "Không thấy bộ tài liệu");
    const plan = docgenStore.getPlan(job.id);
    if (!plan) return bad(res, 400, "Chưa có dàn ý để duyệt");
    if (plan.approvedAt) return bad(res, 409, "Dàn ý đã duyệt rồi");
    const engine = ["per-doc", "single", "per-section"].includes(req.body?.engine) ? req.body.engine : "per-doc";
    const stats = planStats(plan, job.style?.depth);
    const approved = docgenStore.approvePlan(job.id, { engine, estTokens: stats.estTokens });
    const next = docgenStore.patchJob(job.id, {
      // D1 stops at an approved outline; writing (status "writing") starts in D2.
      status: "plan-approved", run: { engine },
      metrics: { ...job.metrics, sections: stats.sections },
    });
    emit(next);
    res.json({ job: withPlanSummary(next), plan: approved, stats });
  });

  // Unfreezing an approved outline. Allowed, because a plan approved by mistake would otherwise
  // force the user to rebuild the whole set — but it resets the progress denominator, so the UI
  // asks first and the section states go back to pending.
  app.post("/api/doc-jobs/:jid/plan/unlock", (req, res) => {
    const job = docgenStore.getJob(req.params.jid);
    if (!job) return bad(res, 404, "Không thấy bộ tài liệu");
    const plan = docgenStore.getPlan(job.id);
    if (!plan) return bad(res, 400, "Chưa có dàn ý");
    if (!plan.approvedAt) return bad(res, 409, "Dàn ý đang mở, không cần mở khoá");
    for (const d of plan.docs || [])
      for (const s of d.sections || []) if (s.status === "skipped") s.status = "pending";
    const next = docgenStore.putPlan(job.id, { ...plan, approvedAt: null });
    const j = docgenStore.patchJob(job.id, { status: "plan-review" });
    emit(j);
    res.json({ job: withPlanSummary(j), plan: next, stats: planStats(next, job.style?.depth) });
  });

  app.post("/api/doc-jobs/:jid/plan/revise", (req, res) => {
    const job = docgenStore.getJob(req.params.jid);
    if (!job) return bad(res, 404, "Không thấy bộ tài liệu");
    if (running.has(job.id)) return bad(res, 409, "Đang chạy một phiên khác cho bộ này");
    const plan = docgenStore.getPlan(job.id);
    if (!plan) return bad(res, 400, "Chưa có dàn ý để sửa");
    if (plan.approvedAt) return bad(res, 409, "Dàn ý đã đóng băng — không sửa được nữa.");
    const text = String(req.body?.text || "").trim();
    if (!text) return bad(res, 400, "Cần mô tả điều muốn sửa");
    const std = standardFor(job);
    const project = store.getProject(job.projectId);
    const eco = economyOf(docgenStore.getSettings());
    if (eco.blockSurvey)
      return bad(res, 403, "Chế độ tiết kiệm đang chặn khảo sát và đề xuất lại dàn ý. "
        + "Sửa dàn ý bằng tay (miễn phí), hoặc tắt “chặn khảo sát” trong cấu hình tiết kiệm.");
    const account = accountFor();
    if (!account) return bad(res, 400, "Chưa có account nào đang bật");
    startSurvey({ job, std, project, account, revise: text });
    res.json({ ok: true });
  });

  app.post("/api/doc-jobs/:jid/plan/save-preset", (req, res) => {
    const job = docgenStore.getJob(req.params.jid);
    if (!job) return bad(res, 404, "Không thấy bộ tài liệu");
    const plan = docgenStore.getPlan(job.id);
    if (!plan) return bad(res, 400, "Chưa có dàn ý");
    const preset = docgenStore.savePreset(planToPreset(plan, {
      name: String(req.body?.name || "").trim() || `${job.name} — dàn ý`,
      standardId: job.standardId,
    }));
    res.json({ preset });
  });

  app.post("/api/doc-jobs/:jid/plan/apply-preset", (req, res) => {
    const job = docgenStore.getJob(req.params.jid);
    if (!job) return bad(res, 404, "Không thấy bộ tài liệu");
    const preset = docgenStore.getPreset(req.body?.presetId);
    if (!preset) return bad(res, 404, "Không thấy preset");
    if (preset.standardId !== job.standardId)
      return bad(res, 400, "Preset thuộc chuẩn khác — không áp được sang bộ này.");
    const cur = docgenStore.getPlan(job.id);
    if (cur?.approvedAt) return bad(res, 409, "Dàn ý đã đóng băng");
    // No survey yet: build the plain outline of the standard first, so a preset is a way to get
    // a usable outline without spending a token.
    const base = cur || buildPlan({ std: standardFor(job), projectName: job.projectName, survey: null, outlineDepth: job.style?.outlineDepth });
    const plan = docgenStore.putPlan(job.id, applyPreset(base, preset));
    if (job.status === "draft") emit(docgenStore.patchJob(job.id, { status: "plan-review" }));
    res.json({ plan, stats: planStats(plan, job.style?.depth) });
  });

  // ---- D2: writing ----------------------------------------------------------------------
  // plan-approved | paused | error | editing -> writing. Re-calling this is how "Tiếp tục" works:
  // the run only claims sections that have no IR yet (plus the stale ones), so nothing already
  // finished is written twice (test cases 8 and 11).
  app.post("/api/doc-jobs/:jid/write", (req, res) => {
    const job = docgenStore.getJob(req.params.jid);
    if (!job) return bad(res, 404, "Không thấy bộ tài liệu");
    if (writes.has(job.id)) return bad(res, 409, "Bộ tài liệu này đang viết");
    if (running.has(job.id)) return bad(res, 409, "Bộ tài liệu này đang khảo sát");
    const plan = docgenStore.getPlan(job.id);
    if (!plan?.approvedAt) return bad(res, 400, "Chưa chốt dàn ý — duyệt dàn ý trước khi viết.");
    const std = standardFor(job);
    if (!std) return bad(res, 400, "Chuẩn không còn tồn tại");
    const project = store.getProject(job.projectId);
    if (!project || !existsSync(project.repo_path)) return bad(res, 400, "Không đọc được thư mục repo của project");
    const account = accountFor();
    if (!account) return bad(res, 400, "Chưa có account nào đang bật — thêm account rồi thử lại.");

    const only = Array.isArray(req.body?.only) && req.body.only.length ? req.body.only.map(String) : null;
    const engine = ENGINES.includes(req.body?.engine)
      ? req.body.engine : (job.run?.engine || plan.engine || "per-doc");
    const targets = pendingSections(job.id, plan, { only });
    if (!targets.length)
      return bad(res, 400, only
        ? "Những mục đã chọn không cần viết lại (đã xong, hoặc đang được đánh dấu sửa tay)."
        : "Không còn mục nào cần viết. Muốn viết lại thì chọn mục cụ thể hoặc bấm ↻ để tìm mục đã cũ.");
    // The run applies the cap itself (claim() is the one place that decides what a pass owns); this
    // is only so the response tells the truth about how many sections this call will write.
    const eco = economyOf(docgenStore.getSettings());
    const capped = capTargets(targets, eco);

    const run = createWriteRun({
      job, std, plan, repoPath: project.repo_path,
      accounts: enabledAccounts(), account, appSettings: store.getSettings(),
      engine, only, broadcast,
    });
    writes.set(job.id, run);
    run.promise
      .catch((err) => {
        const cur = docgenStore.getJob(job.id);
        if (!cur) return;
        emit(docgenStore.patchJob(job.id, {
          status: "error", error: { kind: "write", message: String(err.message).slice(0, 500) },
          write: { ...(cur.write || {}), finishedAt: Date.now(), activity: "" },
        }));
      })
      .finally(() => { writes.delete(job.id); });

    docgenStore.patchJob(job.id, { run: { engine } });
    res.json({ ok: true, engine, sections: capped.targets.length, deferred: capped.deferred,
      economy: eco.on ? eco.notes : null,
      job: withPlanSummary(docgenStore.getJob(job.id)) });
  });

  // ---- run log: what the agent actually did -----------------------------------------------
  // The console reads this, and it is the only answer to "the job failed and there is nothing to
  // look at". Free: reading a file.
  //
  // `after` makes it a cheap poll as well as a WS consumer — the console asks once on open and then
  // lives off doc:log events, but a reconnect must not re-render 2000 rows it already has.
  app.get("/api/doc-jobs/:jid/log", (req, res) => {
    const job = docgenStore.getJob(req.params.jid);
    if (!job) return bad(res, 404, "Không thấy bộ tài liệu");
    const out = runlog.readLog(job.id, {
      after: Math.max(0, Number(req.query.after) || 0),
      limit: Math.min(2000, Math.max(1, Number(req.query.limit) || 400)),
      session: req.query.session ? String(req.query.session) : null,
      kind: req.query.kind ? String(req.query.kind) : null,
      run: req.query.run ? String(req.query.run) : null,
    });
    const st = runlog.logState(job.id, ranInfoOf(job));
    // `note` chỉ có khi có VẤN ĐỀ. "never" (chưa chạy lượt nào) là trạng thái bình thường — gắn một
    // dòng cảnh báo vào đó là dạy người dùng bỏ qua cảnh báo.
    const problem = st.state !== "ok" && st.state !== "never";
    res.json({ ...out, ...st, note: problem ? logStateMessage(st) : null,
      live: writes.has(job.id) || running.has(job.id) });
  });

  // Plain-text download. Attachment, not JSON: the point is to open it in an editor or paste it
  // into a bug report.
  app.get("/api/doc-jobs/:jid/log/download", (req, res) => {
    const job = docgenStore.getJob(req.params.jid);
    if (!job) return bad(res, 404, "Không thấy bộ tài liệu");
    // Gửi một tệp rỗng khi log không có là tệ hơn báo lỗi: người dùng mở ra thấy trắng và không
    // biết vì sao. 404 kèm câu giải thích, UI đã hiện cùng câu đó nên hai nơi không lệch nhau.
    const st = runlog.logState(job.id, ranInfoOf(job));
    if (st.state !== "ok") return res.status(404).json({ ...st, error: logStateMessage(st) });
    const text = runlog.renderLogText(job.id, {
      session: req.query.session ? String(req.query.session) : null,
      run: req.query.run ? String(req.query.run) : null,
    });
    const safe = String(job.name || job.id).replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(0, 60);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${safe}-${job.id}.log"`);
    res.send(text);
  });

  app.delete("/api/doc-jobs/:jid/log", (req, res) => {
    if (!docgenStore.getJob(req.params.jid)) return bad(res, 404, "Không thấy bộ tài liệu");
    if (writes.has(req.params.jid) || running.has(req.params.jid))
      return bad(res, 409, "Đang có phiên chạy — dừng trước khi xoá log.");
    runlog.clearLog(req.params.jid);
    res.json({ ok: true });
  });

  // Everything the progress screen needs in one call: the outline with its per-section state, the
  // content itself, the roll-up numbers and the export history.
  app.get("/api/doc-jobs/:jid/ir", (req, res) => {
    const job = docgenStore.getJob(req.params.jid);
    if (!job) return bad(res, 404, "Không thấy bộ tài liệu");
    const plan = docgenStore.getPlan(job.id);
    const ir = docgenStore.getIr(job.id);
    const { total, docs } = jobMetrics(ir, plan);
    res.json({
      job: withPlanSummary(job), plan, ir, metrics: total, perDoc: docs,
      exports: docgenStore.listExports(job.id),
      writing: writes.has(job.id),
      standard: publicStandard(standardFor(job)),
      economy: economyOf(docgenStore.getSettings()),
    });
  });

  // Q20 — hand editing. Free: no model runs, so there is no token dialog on this path.
  app.put("/api/doc-jobs/:jid/ir", async (req, res) => {
    const job = docgenStore.getJob(req.params.jid);
    if (!job) return bad(res, 404, "Không thấy bộ tài liệu");
    const plan = docgenStore.getPlan(job.id);
    const found = findPlanSection(plan, String(req.body?.id || ""));
    if (!found) return bad(res, 404, "Không thấy mục này trong dàn ý");
    if (!Array.isArray(req.body?.blocks)) return bad(res, 400, "Thiếu danh sách khối nội dung");

    const project = store.getProject(job.projectId);
    const commit = await headCommit(project?.repo_path || ".");
    const key = `${found.doc.key}/${found.section.num}`;
    const ir = normalizeSection(
      { blocks: req.body.blocks, traces: req.body.traces, sources: req.body.sources },
      found.section, { docKey: found.doc.key, commit, sources: found.section.sources });
    if (!ir.blocks.length) return bad(res, 400, "Mục phải còn ít nhất một khối nội dung.");

    const saved = docgenStore.putIrSection(job.id, key, { ...ir, editedAt: Date.now() });
    const m = sectionMetrics(saved);
    // `edited` is a flag that survives every later status change: it is what keeps the writing
    // agent out of this section until the user explicitly gives it back.
    docgenStore.patchPlanSection(job.id, found.section.id, {
      status: "edited", edited: true, editedAt: Date.now(), words: m.words, error: null,
    });
    pushMetrics(job.id);
    broadcast({ type: "doc:section", jobId: job.id, sectionId: found.section.id,
      docKey: found.doc.key, num: found.section.num, status: "edited", metrics: m });
    res.json({ ir: saved, metrics: m, plan: docgenStore.getPlan(job.id) });
  });

  // "Bỏ đánh dấu đã sửa tay" — the only way an agent is allowed to overwrite hand-written text.
  // The UI warns first; this endpoint does not guess.
  app.post("/api/doc-jobs/:jid/ir/unedit", (req, res) => {
    const job = docgenStore.getJob(req.params.jid);
    if (!job) return bad(res, 404, "Không thấy bộ tài liệu");
    const plan = docgenStore.getPlan(job.id);
    const found = findPlanSection(plan, String(req.body?.id || ""));
    if (!found) return bad(res, 404, "Không thấy mục này trong dàn ý");
    const key = `${found.doc.key}/${found.section.num}`;
    const has = !!docgenStore.getIrSection(job.id, key);
    const next = docgenStore.patchPlanSection(job.id, found.section.id, {
      edited: false, editedAt: null,
      status: !has ? "pending" : (found.section.staleFiles?.length ? "stale" : "written"),
    });
    broadcast({ type: "doc:section", jobId: job.id, sectionId: found.section.id,
      docKey: found.doc.key, num: found.section.num, status: next.status });
    res.json({ section: next, plan: docgenStore.getPlan(job.id) });
  });

  // Q21 — which sections point at files that changed since they were written. Free: `git diff`
  // and a set intersection, no model.
  app.post("/api/doc-jobs/:jid/stale", async (req, res) => {
    const job = docgenStore.getJob(req.params.jid);
    if (!job) return bad(res, 404, "Không thấy bộ tài liệu");
    const plan = docgenStore.getPlan(job.id);
    if (!plan) return bad(res, 400, "Chưa có dàn ý");
    const project = store.getProject(job.projectId);
    const result = await detectStale({ plan, ir: docgenStore.getIr(job.id), repoPath: project?.repo_path });
    const changed = applyStale(docgenStore, job.id, docgenStore.getPlan(job.id), result);
    const next = docgenStore.getPlan(job.id);
    if (changed) emit(docgenStore.getJob(job.id), { plan: next });
    res.json({ ...result, changed, plan: next });
  });

  // ---- D2: export -----------------------------------------------------------------------
  app.get("/api/doc-tools", async (req, res) => {
    if (req.query.recheck === "1") forgetPython();
    res.json({ python: await detectPython({ force: req.query.recheck === "1" }) });
  });

  // Nơi lưu sẵn cho hộp Xuất: ba nút thay cho việc lội hộp thoại native mỗi lần. Kèm trạng thái
  // gitignore của từng chỗ, vì đó là thứ quyết định có cảnh báo hay không.
  app.get("/api/doc-dests", async (req, res) => {
    const list = destCandidates();
    const out = [];
    for (const d of list) {
      const git = await gitIgnoreStatus(d.path).catch(() => ({ inRepo: false, ignored: false }));
      out.push({ ...d, ...dirInfo(d.path), git });
    }
    res.json({ dests: out });
  });

  // Kiểm một thư mục người dùng tự chọn/tự gõ. Cùng một hàm với ở trên, nên cảnh báo không thể lệch.
  app.get("/api/doc-dests/check", async (req, res) => {
    const dir = String(req.query.path || "").trim();
    if (!dir) return bad(res, 400, "Thiếu đường dẫn");
    res.json({ path: dir, ...dirInfo(dir),
      git: await gitIgnoreStatus(dir).catch(() => ({ inRepo: false, ignored: false })) });
  });

  // Mở thư mục bằng file manager của OS — sau khi xuất, và từ từng dòng lịch sử xuất.
  // Trả kèm `host`: thư mục mở trên máy chạy SERVER, không phải máy đang mở trình duyệt. Giao diện
  // cần biết để nói đúng, thay vì để người dùng đoán (xem chú thích dài ở `revealDir`).
  app.post("/api/doc-dests/reveal", async (req, res) => {
    try { res.json(await revealDir(String(req.body?.path || ""))); }
    catch (e) { bad(res, 400, String(e.message)); }
  });

  app.get("/api/doc-jobs/:jid/exports", (req, res) => {
    if (!docgenStore.getJob(req.params.jid)) return bad(res, 404, "Không thấy bộ tài liệu");
    res.json({ exports: docgenStore.listExports(req.params.jid) });
  });

  // Content lives in the Studio; exporting is a separate action with its own destination (Q10).
  // Free of tokens — it is all code.
  app.post("/api/doc-jobs/:jid/export", async (req, res) => {
    const job = docgenStore.getJob(req.params.jid);
    if (!job) return bad(res, 404, "Không thấy bộ tài liệu");
    const plan = docgenStore.getPlan(job.id);
    if (!plan) return bad(res, 400, "Chưa có dàn ý");
    const formats = (Array.isArray(req.body?.formats) ? req.body.formats : ["docx"]).map(String);
    const unsupported = formats.filter((f) => f !== "docx");
    if (unsupported.length)
      return bad(res, 400, `Bước này chỉ xuất được .docx. Định dạng ${unsupported.join(", ")} thuộc feature xuất PDF.`);
    const baseDir = String(req.body?.destDir || "").trim();
    if (!baseDir) return bad(res, 400, "Chưa chọn nơi lưu");
    const keys = Array.isArray(req.body?.docs) && req.body.docs.length ? req.body.docs.map(String) : null;
    const draft = req.body?.draft !== false;
    // Hai tuỳ chọn mặc định BẬT, tắt được từ hộp thoại:
    //   subfolder — 6 tệp của một bộ đổ chung một thư mục với bộ khác thì lần thứ hai là lẫn hết
    //   dateStamp — không ghi đè bản cũ, giữ được lịch sử để so
    const subfolder = req.body?.subfolder !== false;
    const dateStamp = req.body?.dateStamp !== false;

    const destDir = subfolder
      ? join(baseDir, safeSeg(job.projectName || "project"), safeSeg(job.name || job.id))
      : baseDir;
    try { ensureDir(destDir); }
    catch (e) { return bad(res, 400, `Không tạo được thư mục lưu: ${e.message}`); }

    const ir = docgenStore.getIr(job.id);
    const specs = exportSpecs({ job, std: standardFor(job), plan, ir, keys, draft, dateStamp });
    if (!specs.length) return bad(res, 400, "Không có tài liệu nào để xuất");

    const out = await renderDocx({ jobId: job.id, docs: specs, destDir, draft });
    if (out.locked) return res.status(400).json({ error: out.error, locked: true, reason: out.reason, tried: out.tried });
    // A file that could not be written is a *skipped file with a name*, not a failed export: the
    // usual cause is "it is open in Word right now", and the user needs to be told which one
    // (RULESET §6 #3). Only a renderer that produced nothing at all is a real failure.
    if (!out.files?.length && !out.skipped?.length) return bad(res, 400, out.error || "Xuất thất bại");

    // Cảnh báo nếu vừa ghi .docx vào một repo git chưa ignore — sau khi ghi, vì lúc đó mới biết
    // chắc thư mục nào thật sự được dùng. Không chặn: người dùng có thể cố ý muốn commit.
    const git = await gitIgnoreStatus(destDir).catch(() => null);
    const warnings = [...(out.warnings || [])];
    if (git?.inRepo && !git.ignored)
      warnings.push(`Thư mục này nằm trong repo git (${git.repoRoot}) và CHƯA được .gitignore. `
        + "Tệp .docx là binary hàng MB — commit vào là repo phình vĩnh viễn. Thêm đường dẫn này vào "
        + ".gitignore, hoặc xuất sang chỗ khác.");

    const rec = docgenStore.addExport(job.id, {
      format: "docx", destDir, draft, python: out.python || null,
      files: (out.files || []).map((f) => ({ path: f.path, bytes: f.bytes, title: f.title, counts: f.counts })),
      skipped: out.skipped || [], warnings, counts: out.counts || {},
      git: git ? { inRepo: git.inRepo, ignored: git.ignored, repoRoot: git.repoRoot } : null,
    });
    broadcast({ type: "doc:export", jobId: job.id, export: rec });
    res.json({ export: rec, exports: docgenStore.listExports(job.id), destDir });
  });

  // Roll the derived numbers back onto the job so the board card is right without opening the job.
  function pushMetrics(jobId) {
    const cur = docgenStore.getJob(jobId);
    if (!cur) return;
    const { total } = jobMetrics(docgenStore.getIr(jobId), docgenStore.getPlan(jobId));
    const job = docgenStore.patchJob(jobId, {
      metrics: { ...cur.metrics, sections: total.sections, done: total.done, words: total.words,
        pages: total.pages, tables: total.tables, figures: total.figures },
    });
    broadcast({ type: "doc:job", jobId, job });
  }

  // ---- estimates ----
  // Every button in the docgen UI shows a forecast; this is where the numbers come from.
  app.get("/api/doc-jobs/:jid/estimate", async (req, res) => {
    const job = docgenStore.getJob(req.params.jid);
    if (!job) return bad(res, 404, "Không thấy bộ tài liệu");
    const std = standardFor(job);
    const plan = docgenStore.getPlan(job.id);
    const settings = docgenStore.getSettings();
    const sectionCount = plan
      ? plan.docs.reduce((n, d) => n + d.sections.length, 0)
      : std.docs.reduce((n, d) => n + d.sections.length, 0);
    const write = plan ? estimatePlan(plan, job.style?.depth) : { tokens: 0, sections: 0 };
    const account = accountFor();
    let usage = null;
    if (account && req.query.usage === "1") usage = await fetchUsage(account.configDir).catch(() => null);

    // What the write buttons actually cost, which is not the same as "the whole plan": a resumed
    // run pays only for what is left, and "viết lại N mục đã cũ" only for the stale ones.
    const depth = job.style?.depth;
    // Economy mode changes what a run costs, so every number the buttons show has to go through the
    // same factor — otherwise the token dialog warns about a price nobody is going to pay.
    const eco = economyOf(settings);
    const f = priceFactor(eco);
    const priceOf = (list) => Math.round(list.reduce((n, t) => n + estimateSection(t.section, depth), 0) * f);
    const rest = plan ? pendingSections(job.id, plan, { only: null }) : [];
    const staleAll = (plan?.docs || []).flatMap((d) => (d.sections || [])
      .filter((s) => s.status === "stale").map((s) => ({ doc: d, section: s })));
    const staleBulk = staleAll.filter((t) => !t.section.edited);
    // What the NEXT click costs, which under a section cap is not what "everything left" costs.
    const nextRun = capTargets(rest, eco);
    const nextStale = capTargets(staleBulk, eco);

    res.json({
      survey: eco.blockSurvey ? 0 : estimateSurvey(sectionCount),
      revise: eco.blockSurvey ? 0 : estimateRevise(sectionCount),
      write: Math.round(write.tokens * f), sections: write.sections,
      // `pending` = số mục lượt tới thật sự viết (đã cắt theo cap) — đó là thứ nút hiển thị.
      // `left` = tổng còn thiếu, để nói “còn N mục nữa sau lượt này”.
      pending: { sections: nextRun.targets.length, tokens: priceOf(nextRun.targets),
        left: rest.length, deferred: nextRun.deferred },
      stale: { sections: nextStale.targets.length, tokens: priceOf(nextStale.targets),
        left: staleBulk.length, deferred: nextStale.deferred,
        held: staleAll.length - staleBulk.length },
      windows: windowsOf(Math.round(write.tokens * f), settings.tokensPer5h),
      tokensPer5h: settings.tokensPer5h, threshold: settings.tokenThreshold,
      economy: eco,
      account: account ? { id: account.id, label: account.label } : null,
      accounts: enabledAccounts().length,
      usage,
    });
  });

  // Estimate for a standard before a job exists (wizard step 3).
  app.get("/api/doc-standards/:sid/estimate", (req, res) => {
    // picks=<std>:<docKey>,… lets the wizard price a custom set before the job exists.
    const picks = String(req.query.picks || "").split(",").filter(Boolean)
      .map((s) => ({ standardId: s.split(":")[0], docKey: s.split(":")[1] }));
    const std = req.params.sid === "custom" ? composeStandard(picks) : getStandard(req.params.sid);
    if (!std || !std.docs.length) return bad(res, 404, "Không thấy chuẩn");
    const sections = std.docs.reduce((n, d) => n + d.sections.length, 0);
    const s = docgenStore.getSettings();
    res.json({ survey: estimateSurvey(sections), revise: estimateRevise(sections),
      sections, threshold: s.tokenThreshold });
  });

  // ---- the surveying session itself ----
  function startSurvey({ job, std, project, account, revise }) {
    const settings = store.getSettings();
    const eco = economyOf(docgenStore.getSettings());
    const started = Date.now();
    const run = runlog.beginRun(job.id, { stage: "survey",
      note: revise ? "▶ bắt đầu đề xuất lại dàn ý" : "▶ bắt đầu khảo sát" });
    const runId = run.runId;
    // Một dòng log + một event WS trong cùng một chỗ, giống WriteRun.say().
    const say = (entry) => {
      const row = runlog.log(job.id, { stage: "survey", run: runId, session: "khảo sát", ...entry });
      broadcast({ type: "doc:log", jobId: job.id, entry: row });
      return row;
    };
    say({ kind: "info", text: "⚙ cấu hình lượt khảo sát",
      detail: [`repo:      ${project.repo_path}`, `account:   ${account.id}`,
        `model:     ${eco.model || settings.model || "(mặc định theo account)"}`,
        `tiết kiệm: ${eco.on ? eco.notes.join(" · ") : "tắt"}`,
        `chế độ:    ${revise ? "đề xuất lại dàn ý" : "khảo sát lần đầu"}`].join("\n") });
    docgenStore.patchJob(job.id, {
      status: "surveying", error: null,
      survey: { startedAt: started, revise: revise || null, account: account.id,
        activity: "Bắt đầu khảo sát…", runId, logHost: run.host, logFile: run.file },
    });
    emit(docgenStore.getJob(job.id));

    const plan = docgenStore.getPlan(job.id);
    let tokens = 0;

    runSurvey({
      job, std, repoPath: project.repo_path, configDir: account.configDir,
      model: eco.model || settings.model, allowCommands: settings.allowCommands !== false,
      revise, plan,
      onSpawn: (child) => running.set(job.id, { child, startedAt: started }),
      onEvent: (e) => {
        if (e.kind === "result") {
          const u = e.usage || {};
          tokens += (u.input_tokens || 0) + (u.output_tokens || 0)
            + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
        }
        say({ kind: e.kind, text: e.text, detail: e.detail, code: e.code });
        const cur = docgenStore.getJob(job.id);
        if (!cur) return;
        // stderr/stdout không lên thanh activity: chúng là dòng kỹ thuật, chỗ của chúng là Console.
        if (e.kind !== "stderr" && e.kind !== "stdout")
          docgenStore.patchJob(job.id, { survey: { ...cur.survey, activity: e.text || cur.survey?.activity } });
        broadcast({ type: "doc:activity", jobId: job.id, text: e.text || "", kind: e.kind });
      },
    }).then(({ survey, exitError }) => {
      running.delete(job.id);
      runlog.endRun(job.id, { stage: "survey", ok: true,
        text: `■ khảo sát xong · ${Math.round((Date.now() - started) / 1000)}s · ${tokens} token`,
        detail: exitError ? `CLI thoát bất thường nhưng tệp kết quả vẫn đọc được: ${exitError}` : undefined });
      const built = buildPlan({ std, projectName: job.projectName, survey, outlineDepth: job.style?.outlineDepth });
      const merged = revise && plan ? mergeRevision(plan, built) : built;
      docgenStore.putPlan(job.id, merged);
      const stats = planStats(merged, job.style?.depth);
      const cur = docgenStore.getJob(job.id);
      const next = docgenStore.patchJob(job.id, {
        status: "plan-review", error: null,
        facts: { stack: survey.stack || null, items: Array.isArray(survey.facts) ? survey.facts.slice(0, 12) : [] },
        survey: { ...cur.survey, finishedAt: Date.now(), elapsedMs: Date.now() - started, tokens,
          activity: "", warning: exitError || null },
        metrics: { ...cur.metrics, sections: stats.sections, tokens: (cur.metrics?.tokens || 0) + tokens },
      });
      emit(next, { plan: merged });
    }).catch((err) => {
      running.delete(job.id);
      // Lý do đầy đủ vào log; `error.message` chỉ 500 ký tự cho thẻ UI.
      runlog.endRun(job.id, { stage: "survey", ok: false, text: `✖ khảo sát thất bại`,
        detail: String(err.stack || err.message) });
      const cur = docgenStore.getJob(job.id);
      if (!cur) return;
      const next = docgenStore.patchJob(job.id, {
        status: "error",
        error: { kind: "survey", message: String(err.message).slice(0, 500), runId },
        survey: { ...cur.survey, finishedAt: Date.now(), tokens },
      });
      emit(next);
    });
  }
}

// Dấu vết trong job rằng đã từng có lượt chạy, và lượt gần nhất chạy ở máy nào.
//
// Cần vì log là tệp cục bộ còn job có thể đến từ database dùng chung (nhánh `local-work`): "không có
// dòng nào" phải phân biệt được "chưa chạy lần nào" với "đã chạy, log ở máy khác hoặc đã bị xoá".
// `logHost` chỉ có từ D2.1 trở đi, nên job cũ sẽ ra `ranHost: null` → rơi vào "missing", đúng hơn là
// khẳng định sai về một máy nào đó.
function ranInfoOf(job) {
  const w = job?.write || {}, s = job?.survey || {};
  const ran = !!(w.startedAt || s.startedAt || job?.metrics?.tokens);
  return { ran, ranHost: w.logHost || s.logHost || null };
}

// Một câu giải thích cho mỗi trạng thái log. Đặt ở server để tệp tải về, thông báo lỗi và màn hình
// đều nói cùng một câu.
function logStateMessage(st) {
  if (st.state === "never")
    return "Bộ tài liệu này chưa chạy lượt nào nên chưa có log. Log được ghi từ lúc bấm Khảo sát "
      + "hoặc Bắt đầu viết.";
  if (st.state === "other-host")
    return `Lượt chạy gần nhất thực hiện trên máy “${st.ranHost}”, còn máy này là “${st.host}”. `
      + "Log phiên agent là tệp trên đĩa nên nó KHÔNG đi theo cơ sở dữ liệu — nó vẫn nằm ở máy kia, "
      + `tại ${st.file}. Chạy lại trên máy này thì sẽ có log mới.`;
  if (st.state === "missing")
    return `Bộ tài liệu này đã từng chạy nhưng không còn tệp log ở máy này. Thường là do thư mục `
      + `docgen-work đã bị xoá, hoặc dataDir đã đổi. Đường dẫn đang tìm: ${st.file}`;
  if (st.state === "unreadable")
    return `Có tệp log nhưng mở không được (quyền truy cập, hoặc tệp đang bị khoá): ${st.file}`;
  return "";
}

// A section is addressed by its plan id everywhere in the API; this is the one place that resolves
// it back to the document it belongs to.
function findPlanSection(plan, id) {
  for (const doc of plan?.docs || []) {
    const section = (doc.sections || []).find((s) => s.id === id);
    if (section) return { doc, section };
  }
  return null;
}

// Một đoạn đường dẫn an toàn cho mọi OS. Tên project/bộ tài liệu do người dùng đặt nên có thể chứa
// `:` `/` `?` — Windows từ chối thẳng. Giữ chữ có dấu (\p{L}) vì tên tiếng Việt là bình thường.
const safeSeg = (s) => String(s).replace(/[^\p{L}\p{N} ._-]+/gu, "-")
  .replace(/\s+/g, " ").replace(/^[-. ]+|[-. ]+$/g, "").slice(0, 80) || "khong-ten";

// Document identifier: the prefix the user chose for this set plus a short tag per document, so
// six files of one standard do not all carry the same id.
function docIdFor(job, doc) {
  const prefix = String(job.meta?.docIdPrefix || "").trim();
  const tag = String(doc.short || doc.key).replace(/[^A-Za-z0-9]+/g, "").toUpperCase().slice(0, 6);
  return prefix ? `${prefix}-${tag}` : tag;
}

// The payload render.py consumes. Sections switched off at approval are not in the file at all;
// sections not yet written are, so the reader can see what is still missing.
function exportSpecs({ job, std, plan, ir, keys, draft, dateStamp = false }) {
  const version = job.meta?.history?.at(-1)?.version || "0.1";
  // Ngày theo giờ máy, không phải UTC: người dùng đọc tên tệp bằng lịch của họ.
  const d = new Date();
  const stamp = dateStamp
    ? ` ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    : "";
  const out = [];
  for (const d of plan.docs || []) {
    if (keys && !keys.includes(d.key)) continue;
    const sections = (d.sections || [])
      .filter((s) => s.enabled !== false && s.status !== "skipped")
      .map((s) => ({ num: s.num, title: s.title, kind: s.kind, ir: ir[`${d.key}/${s.num}`] || null }));
    if (!sections.length) continue;
    const base = String(d.file || `${d.title}.docx`).replace(/\.docx$/i, "");
    out.push({
      key: d.key, file: `${base} v${version}${stamp}.docx`, title: d.title,
      project: job.projectName || "", docId: docIdFor(job, d), version,
      classification: job.meta?.classification || "",
      docStatus: draft ? "Bản nháp" : (job.meta?.docStatus || ""),
      standard: std?.standard || std?.label || "",
      sections,
    });
  }
  return out;
}

// Cards need the plan headline without pulling the whole outline over the wire.
function withPlanSummary(job) {
  if (!job) return job;
  const std = standardFor(job);
  const plan = docgenStore.getPlan(job.id);
  // Written / edited / stale sections per document, so the board card can show a real progress
  // ring instead of a fixed number per status.
  const written = plan ? jobMetrics(docgenStore.getIr(job.id), plan) : null;
  const doneOf = new Map((written?.docs || []).map((d) => [d.key, d]));
  const docs = plan
    ? plan.docs.map((d) => ({ key: d.key, title: d.title, file: d.file,
        sections: d.sections.filter((s) => s.enabled !== false).length,
        done: doneOf.get(d.key)?.done || 0, pages: doneOf.get(d.key)?.pages || 0 }))
    : (std?.docs || []).map((d) => ({ key: d.key, title: d.title,
        file: `${job.projectName} — ${d.short || d.title}.docx`, sections: d.sections.length, done: 0 }));
  // Which Word template this set will actually use: its own beats the studio-wide default.
  const gset = docgenStore.getSettings();
  const own = job.style?.templatePath || "";
  return {
    ...job,
    template: { path: own || gset.defaultTemplatePath || "",
      source: own ? "set" : (gset.defaultTemplatePath ? "global" : "none") },
    standardLabel: std?.label || job.standardId,
    docCount: docs.length,
    sectionCount: docs.reduce((n, d) => n + d.sections, 0),
    docs,
    planApproved: !!plan?.approvedAt,
    planRevision: plan?.revision || 0,
    progress: written ? written.total : null,
    staleCount: (plan?.docs || []).flatMap((d) => d.sections || [])
      .filter((s) => s.status === "stale").length,
    editedCount: (plan?.docs || []).flatMap((d) => d.sections || [])
      .filter((s) => s.edited).length,
    exportCount: docgenStore.listExports(job.id).length,
  };
}
