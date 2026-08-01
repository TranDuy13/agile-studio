// Kiểm tầng HTTP của docgen trên cổng RIÊNG (4399), không đụng server 4311 của chủ repo.
// Chỉ gọi các route ĐỌC + các route ghi vào bộ tài liệu do chính bài test tạo ra.
import express from "express";
import { registerDocRoutes } from "../server/routes/docgen.js";
import { store } from "../server/store.js";
import { docgenStore } from "../server/store/docgen.js";
import * as runlog from "../server/docgen/runlog.js";
import { DEMO_NAME, DEMO_DIR } from "../server/docgen/demo.js";

const PORT = 4399;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${x}`)); };

const app = express();
app.use(express.json({ limit: "30mb" }));
const events = [];
registerDocRoutes(app, (m) => events.push(m));
const srv = app.listen(PORT);
await new Promise((r) => srv.on("listening", r));
await new Promise((r) => setTimeout(r, 900));   // đợi bootstrap demo (IIFE async) chạy xong

const get = (p) => fetch(`http://localhost:${PORT}${p}`).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
const getText = (p) => fetch(`http://localhost:${PORT}${p}`).then(async (r) => ({ status: r.status, text: await r.text(), headers: r.headers }));
const post = (p, b) => fetch(`http://localhost:${PORT}${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b || {}) })
  .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
const put = (p, b) => fetch(`http://localhost:${PORT}${p}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })
  .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

// ---- bootstrap project mẫu -------------------------------------------------------------------
console.log("\n[bootstrap project mẫu]");
const demo = store.listProjects().find((p) => p.name === DEMO_NAME);
ok("project stale-demo tồn tại", !!demo, JSON.stringify(store.listProjects().map((p) => p.name)));
ok("repo_path đã trỏ về dataDir",
  demo && demo.repo_path.replace(/\\/g, "/").toLowerCase() === DEMO_DIR.replace(/\\/g, "/").toLowerCase(),
  demo?.repo_path);
const { existsSync } = await import("node:fs");
ok("thư mục repo mẫu có thật", existsSync(demo.repo_path));
ok("có tệp nguồn để agent đọc", existsSync(demo.repo_path + "/src/reminders.js"));
ok("project mẫu có bộ tài liệu (seed hoặc có sẵn)", docgenStore.listJobs(demo.id).length > 0,
  String(docgenStore.listJobs(demo.id).length));

// ---- cổng chặn -------------------------------------------------------------------------------
console.log("\n[không còn cổng chặn]");
const real = store.listProjects().find((p) => p.name === "test-monorepo-turborepo");
{
  const r = await get(`/api/projects/${demo.id}/doc-jobs`);
  ok("không trả gate nữa", r.body?.gate === undefined, JSON.stringify(r.body?.gate));
  ok("trả kèm economy đã tính", !!r.body?.economy?.notes, JSON.stringify(r.body?.economy));
  ok("economy kèm trạng thái khoá", typeof r.body.economy.locked === "boolean", JSON.stringify(r.body.economy));
}
if (real) {
  // Repo thật giờ chạy được: chi phí do chế độ tiết kiệm bị ép giữ, không phải danh sách trắng.
  const c = await post(`/api/projects/${real.id}/doc-jobs`, { standardId: "arc42", name: "zz-test-tao-duoc" });
  ok("tạo bộ tài liệu trên repo thật KHÔNG còn 403", c.status !== 403, `${c.status} ${JSON.stringify(c.body)}`);
  if (c.status === 200 && c.body?.job?.id) {
    const w = await post(`/api/doc-jobs/${c.body.job.id}/write`);
    ok("viết KHÔNG còn 403 — bị từ chối vì lý do nghiệp vụ",
      w.status !== 403 && /dàn ý/.test(w.body?.error || ""), `${w.status} ${JSON.stringify(w.body)}`);
    // Dọn ngay: bài test không được để lại bộ tài liệu rác trên project thật.
    await fetch(`http://localhost:${PORT}/api/doc-jobs/${c.body.job.id}`, { method: "DELETE" });
    ok("test tự dọn bộ tài liệu vừa tạo", !docgenStore.getJob(c.body.job.id));
  }
} else {
  console.log("  (bỏ qua: không còn project test-monorepo-turborepo)");
}

// ---- agent-settings: economy ------------------------------------------------------------------
console.log("\n[agent-settings · economy]");
const before = (await get("/api/agent-settings")).body;
ok("trả về economy", !!before?.economy, JSON.stringify(before?.economy));
ok("mặc định TẮT (bản ship, DEV_LOCK_ECONOMY=false)", before.economy.on === false, JSON.stringify(before.economy));
{
  // Bật tường minh rồi kiểm: các field trong patch áp đúng, field vắng lấy mặc định (không thành rác).
  const r = await put("/api/agent-settings", { economy: { on: true, maxSectionsPerRun: 3 } });
  ok("patch áp giá trị + field vắng lấy mặc định",
    r.body.economy.maxSectionsPerRun === 3 && r.body.economy.on === true && r.body.economy.shortPrompt === true,
    JSON.stringify(r.body.economy));
  const r2 = await put("/api/agent-settings", { economy: { maxSectionsPerRun: 999 } });
  ok("kẹp giá trị vô lý", r2.body.economy.maxSectionsPerRun === 50);
  // trả về như cũ
  await put("/api/agent-settings", { economy: before.economy });
  const r3 = await get("/api/agent-settings");
  ok("trả lại được cấu hình ban đầu",
    r3.body.economy.maxSectionsPerRun === before.economy.maxSectionsPerRun);
}

// ---- estimate: con số phải theo cap -----------------------------------------------------------
console.log("\n[estimate · theo giới hạn tiết kiệm]");
{
  const approved = docgenStore.listJobs(demo.id).find((j) => {
    const p = docgenStore.getPlan(j.id);
    return p?.approvedAt;
  });
  if (!approved) { console.log("  (bỏ qua: project mẫu chưa có bộ nào chốt dàn ý)"); }
  else {
    // Bản ship mặc định tắt tiết kiệm; bật rõ để kiểm cap thật sự cắt số mục/lượt.
    await put("/api/agent-settings", { economy: { on: true } });
    const on = (await get(`/api/doc-jobs/${approved.id}/estimate`)).body;
    const cap = on.economy.maxSections;
    ok("pending.sections ≤ cap", on.pending.sections <= cap, JSON.stringify(on.pending));
    ok("có pending.left = tổng còn thiếu", typeof on.pending.left === "number", JSON.stringify(on.pending));
    ok("left ≥ sections", on.pending.left >= on.pending.sections);
    ok("có deferred để UI nói còn bao nhiêu đợi lượt sau",
      on.pending.deferred === on.pending.left - on.pending.sections, JSON.stringify(on.pending));

    // Đang bị ép: gửi { on: false } qua API cũng KHÔNG được mở khoá. Đây là điểm quan trọng nhất —
    // nếu API nới được thì cái ép chỉ là trang trí trên UI.
    await put("/api/agent-settings", { economy: { on: false, capSections: false } });
    const off = (await get(`/api/doc-jobs/${approved.id}/estimate`)).body;
    if (on.economy.locked) {
      ok("ÉP: gửi on=false qua API vẫn không mở được", off.economy.on === true && off.economy.locked === true,
        JSON.stringify(off.economy));
      ok("ÉP: vẫn cắt theo cap rẻ nhất", off.pending.sections === cap, JSON.stringify(off.pending));
    } else {
      ok("mở khoá: tắt tiết kiệm → không cắt", off.pending.sections === off.pending.left,
        JSON.stringify(off.pending));
      ok("mở khoá: tắt tiết kiệm → giá cao hơn", off.pending.tokens >= on.pending.tokens,
        `on=${on.pending.tokens} off=${off.pending.tokens}`);
    }

    // blockSurvey phải chặn thật ở API, không chỉ ở UI. Nút này KHÔNG bị ép nên vẫn đổi được.
    await put("/api/agent-settings", { economy: { on: true, blockSurvey: true } });
    const s = await post(`/api/doc-jobs/${approved.id}/survey`);
    ok("blockSurvey chặn khảo sát → 403", s.status === 403, `${s.status} ${JSON.stringify(s.body)}`);
    const e2 = (await get(`/api/doc-jobs/${approved.id}/estimate`)).body;
    ok("blockSurvey → dự báo khảo sát về 0", e2.survey === 0, String(e2.survey));

    await put("/api/agent-settings", { economy: before.economy });
  }
}

// ---- API log ---------------------------------------------------------------------------------
console.log("\n[API log]");
{
  const job = docgenStore.listJobs(demo.id)[0];
  runlog.clearLog(job.id);
  const { runId: rid } = runlog.beginRun(job.id, { stage: "write", engine: "per-doc" });
  runlog.log(job.id, { stage: "write", session: "sad", kind: "tool", text: "📖 đọc src/reminders.js",
    detail: '{\n "file_path": "src/reminders.js"\n}' });
  runlog.log(job.id, { stage: "write", session: "sad", kind: "stderr", text: "Error: ENOENT",
    detail: "Error: ENOENT\n  at Object.openSync" });
  runlog.log(job.id, { stage: "write", session: "sad", kind: "exit", text: "✖ phiên thoát 1", code: 1 });

  const r = await get(`/api/doc-jobs/${job.id}/log`);
  ok("GET /log → 200", r.status === 200);
  ok("trả đủ dòng", r.body.entries.length === 4, String(r.body.entries.length));
  ok("giữ detail đầy đủ", r.body.entries.find((e) => e.kind === "stderr").detail.includes("openSync"));
  ok("trả lastSeq để poll tiếp", r.body.lastSeq === 4, String(r.body.lastSeq));
  ok("liệt kê session cho bộ lọc", r.body.sessions.includes("sad"));
  ok("liệt kê run", r.body.runs.includes(rid));
  ok("báo live=false khi không chạy", r.body.live === false);
  ok("báo kích thước log", r.body.bytes > 0, String(r.body.bytes));

  const p = await get(`/api/doc-jobs/${job.id}/log?kind=problem`);
  ok("lọc problem", p.body.entries.length === 2,
    JSON.stringify(p.body.entries.map((e) => e.kind)));
  const a = await get(`/api/doc-jobs/${job.id}/log?after=2`);
  ok("after=2 chỉ trả dòng mới", a.body.entries.length === 2);

  const dl = await getText(`/api/doc-jobs/${job.id}/log/download`);
  ok("tải log → 200 text/plain", dl.status === 200 && /text\/plain/.test(dl.headers.get("content-type")));
  ok("tải log là attachment có tên tệp",
    /attachment; filename=/.test(dl.headers.get("content-disposition") || ""),
    dl.headers.get("content-disposition"));
  ok("nội dung tải về có detail thụt lề", dl.text.includes("│ ") && dl.text.includes("openSync"));

  const bad = await get(`/api/doc-jobs/khong-ton-tai/log`);
  ok("job không tồn tại → 404", bad.status === 404);

  const del = await fetch(`http://localhost:${PORT}/api/doc-jobs/${job.id}/log`, { method: "DELETE" });
  ok("DELETE /log → 200", del.status === 200);
  ok("xoá xong log rỗng", (await get(`/api/doc-jobs/${job.id}/log`)).body.entries.length === 0);
}

// ---- ca 11: job bị ngắt phải có lý do -------------------------------------------------------
console.log("\n[ca 11 · lý do khi bị ngắt]");
{
  // Dựng đúng hiện trạng: một job đang "writing" + log có hoạt động, rồi nạp lại routes
  // (= server restart) và xem job có được giải thích không.
  const job = docgenStore.listJobs(demo.id).find((j) => docgenStore.getPlan(j.id)?.approvedAt)
    || docgenStore.listJobs(demo.id)[0];
  runlog.clearLog(job.id);
  runlog.beginRun(job.id, { stage: "write", engine: "per-doc" });
  runlog.log(job.id, { stage: "write", session: "sad", kind: "tool", text: "🔧 TodoWrite",
    detail: '{"todos":[{"content":"Đọc README"}]}' });
  runlog.log(job.id, { stage: "write", session: "sad", kind: "tool", text: "📖 đọc src/notify.js" });
  const saved = docgenStore.getJob(job.id).status;
  docgenStore.patchJob(job.id, { status: "writing" });

  const app2 = express();
  app2.use(express.json());
  registerDocRoutes(app2, () => {});
  await new Promise((r) => setTimeout(r, 300));

  const after = docgenStore.getJob(job.id);
  ok("job về error", after.status === "error", after.status);
  ok("vẫn có câu ngắn như trước", /Server khởi động lại khi đang viết/.test(after.error.message));
  ok("CÓ lý do vì sao không có lỗi từ Claude", !!after.error.why, JSON.stringify(after.error.why));
  ok("lý do giải thích CLI bị kill", /bị kill/.test(after.error.why));
  ok("lý do chỉ đường tới Console", /Console/.test(after.error.why));
  ok("CÓ dòng cuối agent kịp phát", !!after.error.lastActivity, String(after.error.lastActivity));
  ok("dòng cuối đúng là hoạt động thật", /notify\.js/.test(after.error.lastActivity),
    after.error.lastActivity);
  ok("CÓ trace mấy dòng cuối", after.error.trace?.length >= 2, String(after.error.trace?.length));
  ok("trace giữ được TodoWrite", after.error.trace.some((e) => /TodoWrite/.test(e.text)),
    JSON.stringify(after.error.trace.map((e) => e.text)));

  const lg = await get(`/api/doc-jobs/${job.id}/log?kind=problem`);
  ok("log có ghi dòng giải thích lượt bị cắt",
    lg.body.entries.some((e) => /server restart/.test(e.text)),
    JSON.stringify(lg.body.entries.map((e) => e.text)));
  ok("dòng đó có detail dài giải thích",
    lg.body.entries.some((e) => /không có mã thoát/.test(e.detail || "")));

  docgenStore.patchJob(job.id, { status: saved, error: null });
  runlog.clearLog(job.id);
}

// ---- log không có / ở máy khác ---------------------------------------------------------------
console.log("\n[log thiếu · máy khác]");
{
  const job = docgenStore.listJobs(demo.id)[0];
  const saved = docgenStore.getJob(job.id).write;
  runlog.clearLog(job.id);

  // 1) chưa chạy lần nào → "never", câu chữ phải là "chưa có log", không phải "mất log"
  docgenStore.patchJob(job.id, { write: null, survey: null, metrics: { tokens: 0 } });
  let r = await get(`/api/doc-jobs/${job.id}/log`);
  ok("chưa chạy → state=never", r.body.state === "never", r.body.state);
  ok("never: không có note báo lỗi", !r.body.note);

  // 2) đã chạy trên máy này, tệp bị xoá → "missing"
  docgenStore.patchJob(job.id, { write: { startedAt: Date.now(), logHost: runlog.HOST } });
  r = await get(`/api/doc-jobs/${job.id}/log`);
  ok("đã chạy, tệp bị xoá → state=missing", r.body.state === "missing", r.body.state);
  ok("missing: có câu giải thích", /đã từng chạy nhưng không còn tệp log/.test(r.body.note || ""),
    r.body.note);
  ok("missing: nói rõ đường dẫn đang tìm", (r.body.note || "").includes("run.log"));

  // 3) đã chạy trên MÁY KHÁC → "other-host". Đây là tình huống của nhánh local-work: job đến từ
  //    database dùng chung, còn log là tệp cục bộ nên nó ở lại máy kia.
  docgenStore.patchJob(job.id, { write: { startedAt: Date.now(), logHost: "may-khac-01" } });
  r = await get(`/api/doc-jobs/${job.id}/log`);
  ok("đã chạy máy khác → state=other-host", r.body.state === "other-host", r.body.state);
  ok("other-host: nêu tên CẢ HAI máy",
    (r.body.note || "").includes("may-khac-01") && (r.body.note || "").includes(runlog.HOST),
    r.body.note);
  ok("other-host: nói rõ log KHÔNG đi theo database",
    /KHÔNG đi theo cơ sở dữ liệu/.test(r.body.note || ""), r.body.note);
  ok("other-host: trả ranHost cho UI", r.body.ranHost === "may-khac-01");

  // 4) tải log khi không có → 404 kèm giải thích, KHÔNG gửi tệp rỗng
  const dl = await get(`/api/doc-jobs/${job.id}/log/download`);
  ok("tải log khi thiếu → 404", dl.status === 404, String(dl.status));
  ok("404 kèm cùng câu giải thích", (dl.body?.error || "").includes("may-khac-01"), dl.body?.error);
  ok("404 kèm state để UI xử lý", dl.body?.state === "other-host");

  // 5) có tệp lại → ok
  runlog.beginRun(job.id, { stage: "write" });
  r = await get(`/api/doc-jobs/${job.id}/log`);
  ok("có tệp → state=ok", r.body.state === "ok", r.body.state);
  ok("state ok thì không có note", !r.body.note);
  const dl2 = await getText(`/api/doc-jobs/${job.id}/log/download`);
  ok("tải được khi có tệp", dl2.status === 200);

  runlog.clearLog(job.id);
  docgenStore.patchJob(job.id, { write: saved });
}

// ---- nơi lưu khi xuất ------------------------------------------------------------------------
console.log("\n[nơi lưu khi xuất]");
{
  const r = await get("/api/doc-dests");
  ok("GET /api/doc-dests → 200", r.status === 200);
  ok("trả 2 nơi lưu", r.body.dests.length === 2, String(r.body.dests.length));
  ok("KHÔNG còn nút 'Thư mục dữ liệu Studio'", !r.body.dests.some((d) => d.id === "data"),
    JSON.stringify(r.body.dests.map((d) => d.id)));
  ok("mỗi nơi có trạng thái gitignore", r.body.dests.every((d) => d.git && "ignored" in d.git),
    JSON.stringify(r.body.dests.map((d) => d.git)));
  const repo = r.body.dests.find((d) => d.id === "repo");
  ok("repo/exports: trong repo git và ĐÃ ignore", repo.git.inRepo && repo.git.ignored,
    JSON.stringify(repo.git));
  ok("repo/exports là nơi đề xuất mặc định", repo.preferred === true);

  // Thư mục trong repo mà chưa ignore → phải báo, đây là cái tránh commit .docx hàng MB.
  const bad1 = await get(`/api/doc-dests/check?path=${encodeURIComponent(process.cwd() + "/server")}`);
  ok("check: thư mục chưa ignore → cảnh báo được",
    bad1.body.git.inRepo === true && bad1.body.git.ignored === false, JSON.stringify(bad1.body.git));
  const ok1 = await get(`/api/doc-dests/check?path=${encodeURIComponent(repo.path)}`);
  ok("check: thư mục đã ignore → không cảnh báo", ok1.body.git.ignored === true);
  ok("check: thiếu path → 400", (await get("/api/doc-dests/check")).status === 400);

  // Mở thư mục: chỉ kiểm nhánh LỖI. Nhánh thành công sẽ bật một cửa sổ Explorer lên màn hình người
  // đang chạy test — bài test không được phép làm thế.
  const rv = await post("/api/doc-dests/reveal", { path: "Z:/khong-he-ton-tai-" + Date.now() });
  ok("mở thư mục không tồn tại → 400 kèm lý do đọc được",
    rv.status === 400 && /không tồn tại/i.test(rv.body?.error || ""), JSON.stringify(rv.body));
  ok("thiếu path → 400 chứ không phải mở nhầm thư mục nào đó",
    (await post("/api/doc-dests/reveal", {})).status === 400);
}

srv.close();
console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} đạt · ${fail} lỗi`);
process.exit(fail === 0 ? 0 : 1);
