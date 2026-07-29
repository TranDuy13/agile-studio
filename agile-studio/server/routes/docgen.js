// Every docgen HTTP route lives here. Registered from index.js with two lines, so the rest of
// the server is untouched by this feature.
import { existsSync } from "node:fs";
import { store } from "../store.js";
import { docgenStore } from "../store/docgen.js";
import { enabledAccounts, fetchUsage } from "../accounts.js";
import { killChild } from "../runner.js";
import { listStandards, getStandard, publicStandard, composeStandard, listComposableDocs }
  from "../docgen/standards/index.js";
import { runSurvey } from "../docgen/survey.js";
import { buildPlan, mergeRevision, planToPreset, applyPreset, planStats } from "../docgen/plan.js";
import { estimateSurvey, estimateRevise, estimatePlan, windowsOf } from "../docgen/estimate.js";
import { gitAuthors, scanPreview } from "../docgen/gitscan.js";

// Surveys currently running, so they can be stopped and so a second start is refused.
const running = new Map(); // jobId -> { child, startedAt }

const bad = (res, code, msg) => res.status(code).json({ error: msg });

// Which account a docgen session runs on: the preferred one when it is still enabled,
// otherwise the first enabled account. Mirrors what the session manager does.
function accountFor() {
  const list = enabledAccounts();
  const preferred = store.getSettings().preferredAccount;
  return list.find((a) => a.id === preferred) || list[0] || null;
}

// A job either points at a declared standard, or carries the picks of a custom set.
function standardFor(job) {
  if (!job) return null;
  return job.standardId === "custom" ? composeStandard(job.customDocs || []) : getStandard(job.standardId);
}

export function registerDocRoutes(app, broadcast = () => {}) {
  const emit = (job, extra = {}) => broadcast({ type: "doc:job", jobId: job.id, job, ...extra });

  // A survey that was interrupted by a restart is not "still running" — mark it so the card
  // offers "Tiếp tục" instead of a spinner that never ends (test case 10).
  for (const job of docgenStore.listJobs()) {
    if (job.status === "surveying")
      docgenStore.patchJob(job.id, { status: "error",
        error: { kind: "interrupted", message: "Server khởi động lại khi đang khảo sát — bấm Tiếp tục để chạy lại." } });
  }

  // ---- standards & presets (studio-wide) ----
  app.get("/api/doc-standards", (req, res) =>
    res.json({ standards: listStandards(), composable: listComposableDocs() }));

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

  // ---- docgen settings (token threshold + "đừng hỏi lại" theo loại việc) ----
  app.get("/api/doc-settings", (req, res) => res.json(docgenStore.getSettings()));
  app.put("/api/doc-settings", (req, res) => {
    const patch = {};
    if (req.body.tokenThreshold !== undefined)
      patch.tokenThreshold = Math.max(0, Number(req.body.tokenThreshold) || 0);
    if (req.body.tokensPer5h !== undefined)
      patch.tokensPer5h = Math.max(1000, Number(req.body.tokensPer5h) || 2000000);
    if (req.body.dontAsk && typeof req.body.dontAsk === "object") patch.dontAsk = req.body.dontAsk;
    res.json(docgenStore.setSettings(patch));
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

  // ---- jobs ----
  app.get("/api/projects/:id/doc-jobs", (req, res) => {
    const p = store.getProject(req.params.id);
    if (!p) return bad(res, 404, "Không thấy project");
    const jobs = docgenStore.listJobs(p.id).map((j) => withPlanSummary(j));
    res.json({ jobs, storage: docgenStore.status() });
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
      // The main source is the project repo and stays locked (Q6). Extra folders are only ever
      // additions belonging to the same product.
      sources: {
        main: { projectId: p.id, path: p.repo_path },
        extra: (b.sources?.extra || []).filter((e) => e?.path && existsSync(e.path))
          .map((e, i) => ({ id: "x" + i, kind: e.kind === "reference" ? "reference" : "code", path: e.path })),
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
        templateId: b.style?.templateId || null, tone: b.style?.tone || "concise",
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
    const next = docgenStore.patchJob(job.id, patch);
    emit(next);
    res.json({ job: withPlanSummary(next) });
  });

  app.delete("/api/doc-jobs/:jid", (req, res) => {
    const job = docgenStore.getJob(req.params.jid);
    if (!job) return bad(res, 404, "Không thấy bộ tài liệu");
    const live = running.get(job.id);
    if (live) { killChild(live.child); running.delete(job.id); }
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
    const account = accountFor();
    if (!account) return bad(res, 400, "Chưa có account nào đang bật — thêm account rồi thử lại.");

    // "Tiếp tục" after a failed revision retries the revision, not a full survey — otherwise a
    // hiccup would throw away an outline the user has already been editing.
    const retryRevise = job.status === "error" && job.survey?.revise && docgenStore.getPlan(job.id)
      ? job.survey.revise : null;
    startSurvey({ job, std, project, account, revise: retryRevise });
    res.json({ ok: true, job: withPlanSummary(docgenStore.getJob(job.id)) });
  });

  app.post("/api/doc-jobs/:jid/stop", (req, res) => {
    const live = running.get(req.params.jid);
    if (!live) return bad(res, 404, "Không có phiên nào đang chạy");
    killChild(live.child);
    res.json({ ok: true });
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
    const base = cur || buildPlan({ std: standardFor(job), projectName: job.projectName, survey: null });
    const plan = docgenStore.putPlan(job.id, applyPreset(base, preset));
    if (job.status === "draft") emit(docgenStore.patchJob(job.id, { status: "plan-review" }));
    res.json({ plan, stats: planStats(plan, job.style?.depth) });
  });

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
    res.json({
      survey: estimateSurvey(sectionCount),
      revise: estimateRevise(sectionCount),
      write: write.tokens, sections: write.sections,
      windows: windowsOf(write.tokens, settings.tokensPer5h),
      tokensPer5h: settings.tokensPer5h, threshold: settings.tokenThreshold,
      account: account ? { id: account.id, label: account.label } : null,
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
    const started = Date.now();
    docgenStore.patchJob(job.id, {
      status: "surveying", error: null,
      survey: { startedAt: started, revise: revise || null, account: account.id, activity: "Bắt đầu khảo sát…" },
    });
    emit(docgenStore.getJob(job.id));

    const plan = docgenStore.getPlan(job.id);
    let tokens = 0;

    runSurvey({
      job, std, repoPath: project.repo_path, configDir: account.configDir,
      model: settings.model, allowCommands: settings.allowCommands !== false,
      revise, plan,
      onSpawn: (child) => running.set(job.id, { child, startedAt: started }),
      onEvent: (e) => {
        if (e.kind === "result") {
          const u = e.usage || {};
          tokens += (u.input_tokens || 0) + (u.output_tokens || 0)
            + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
        }
        const cur = docgenStore.getJob(job.id);
        if (!cur) return;
        docgenStore.patchJob(job.id, { survey: { ...cur.survey, activity: e.text || cur.survey?.activity } });
        broadcast({ type: "doc:activity", jobId: job.id, text: e.text || "", kind: e.kind });
      },
    }).then(({ survey, exitError }) => {
      running.delete(job.id);
      const built = buildPlan({ std, projectName: job.projectName, survey });
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
      const cur = docgenStore.getJob(job.id);
      if (!cur) return;
      const next = docgenStore.patchJob(job.id, {
        status: "error",
        error: { kind: "survey", message: String(err.message).slice(0, 500) },
        survey: { ...cur.survey, finishedAt: Date.now(), tokens },
      });
      emit(next);
    });
  }
}

// Cards need the plan headline without pulling the whole outline over the wire.
function withPlanSummary(job) {
  if (!job) return job;
  const std = standardFor(job);
  const plan = docgenStore.getPlan(job.id);
  const docs = plan
    ? plan.docs.map((d) => ({ key: d.key, title: d.title, file: d.file,
        sections: d.sections.filter((s) => s.enabled !== false).length }))
    : (std?.docs || []).map((d) => ({ key: d.key, title: d.title,
        file: `${job.projectName} — ${d.short || d.title}.docx`, sections: d.sections.length }));
  return {
    ...job,
    standardLabel: std?.label || job.standardId,
    docCount: docs.length,
    sectionCount: docs.reduce((n, d) => n + d.sections, 0),
    docs,
    planApproved: !!plan?.approvedAt,
    planRevision: plan?.revision || 0,
  };
}
