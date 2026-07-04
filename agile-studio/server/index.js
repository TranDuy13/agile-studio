import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { store } from "./store.js";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
const pexecFile = promisify(execFile);
import { loadAccounts, pickAccount, fetchModels, fetchUsage, fetchProfile, addAccount, removeAccount, setAccountEnabled, enabledAccounts, newAccountConfigDir, isLoggedIn } from "./accounts.js";
import { runClaude, ROLE_ORDER, ROLE_META } from "./runner.js";
import { resolveWorkspace, buildRolePrompt, learnFromRun, listSkills, roleHasOutputs,
  saveSkill, listDocs, readDoc, writeDoc } from "./scaffold.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "30mb" })); // đủ cho upload file requirement (base64)

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REQ_UPLOAD = join(APP_ROOT, "requirements"); // file requirement lưu theo project trong agile-studio

const http = createServer(app);
const wss = new WebSocketServer({ server: http });
const clients = new Set();
wss.on("connection", (ws) => { clients.add(ws); ws.on("close", () => clients.delete(ws)); });
function broadcast(msg) {
  const s = JSON.stringify(msg);
  for (const ws of clients) if (ws.readyState === ws.OPEN) ws.send(s);
}

// Nhiều session chạy SONG SONG (như nhiều tab Claude Code). Mỗi session có state riêng.
const sessions = new Map(); // sessionId -> session
let SEQ = 0;
const MAX_KEEP = 40;        // giữ tối đa N session gần nhất trong bộ nhớ

// ---- REST ----
// Mở hộp thoại chọn folder native (macOS) và trả về đường dẫn tuyệt đối.
app.post("/api/pick-folder", async (req, res) => {
  if (process.platform !== "darwin")
    return res.status(400).json({ error: "Chọn folder native chỉ hỗ trợ macOS — nhập đường dẫn thủ công.", manual: true });
  try {
    const { stdout } = await pexecFile("osascript", ["-e", 'POSIX path of (choose folder with prompt "Chọn folder repo của project")']);
    let path = stdout.trim();
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1); // bỏ dấu / cuối
    res.json({ path });
  } catch {
    res.json({ canceled: true }); // user bấm Cancel
  }
});

app.get("/api/projects", (req, res) => res.json(store.listProjects()));
app.post("/api/projects", (req, res) => {
  const { name, repo_path } = req.body;
  if (!name || !repo_path) return res.status(400).json({ error: "Cần tên và đường dẫn repo" });
  if (!existsSync(repo_path)) return res.status(400).json({ error: "Đường dẫn không tồn tại" });
  try { const r = store.addProject(name, repo_path); res.json({ id: r.lastInsertRowid }); }
  catch (e) { res.status(400).json({ error: String(e.message) }); }
});

app.get("/api/projects/:id/requirements", (req, res) =>
  res.json(store.listRequirements(req.params.id)));
app.post("/api/projects/:id/requirements", (req, res) => {
  const { body } = req.body;
  const day = req.body.day || new Date().toISOString().slice(0, 10);
  if (!body?.trim()) return res.status(400).json({ error: "Requirement rỗng" });
  const r = store.addRequirement(req.params.id, day, body.trim());
  res.json({ id: r.lastInsertRowid });
});
app.delete("/api/requirements/:id", (req, res) => {
  store.deleteRequirement(req.params.id); res.json({ ok: true });
});

// Đánh dấu requirement đã giải quyết / mở lại.
app.patch("/api/requirements/:id", (req, res) => {
  const status = req.body.status === "resolved" ? "resolved" : "open";
  const r = store.setRequirementStatus(req.params.id, status);
  if (!r) return res.status(404).json({ error: "Không thấy requirement" });
  broadcast({ type: "requirement:updated", projectId: r.project_id });
  res.json({ ok: true, status });
});

// Upload file cho requirement (base64 trong JSON — không cần thêm dependency). Lưu theo project.
app.post("/api/requirements/:id/files", (req, res) => {
  const r = store.getRequirement(req.params.id);
  if (!r) return res.status(404).json({ error: "Không thấy requirement" });
  const { name, data } = req.body;
  if (!name || !data) return res.status(400).json({ error: "Thiếu name/data" });
  const safe = basename(String(name)).replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "file";
  const dir = join(REQ_UPLOAD, String(r.project_id), String(r.id));
  mkdirSync(dir, { recursive: true });
  const buf = Buffer.from(String(data).replace(/^data:[^,]*,/, ""), "base64");
  const fp = join(dir, safe);
  writeFileSync(fp, buf);
  const meta = { name: safe, size: buf.length, path: fp, uploadedAt: new Date().toISOString() };
  store.addRequirementFile(r.id, meta);
  broadcast({ type: "requirement:updated", projectId: r.project_id });
  res.json({ ok: true, file: meta });
});

// Tải file đính kèm.
app.get("/api/requirements/:id/files/:idx", (req, res) => {
  const r = store.getRequirement(req.params.id);
  const f = r && r.files && r.files[Number(req.params.idx)];
  if (!f || !existsSync(f.path)) return res.status(404).json({ error: "Không thấy file" });
  res.download(f.path, f.name);
});

// Xoá file đính kèm.
app.delete("/api/requirements/:id/files/:idx", (req, res) => {
  const f = store.removeRequirementFile(req.params.id, Number(req.params.idx));
  if (f && f.path) { try { rmSync(f.path); } catch {} }
  const r = store.getRequirement(req.params.id);
  if (r) broadcast({ type: "requirement:updated", projectId: r.project_id });
  res.json({ ok: true });
});

app.get("/api/accounts", async (req, res) => {
  const withUsage = req.query.usage === "1"; // chỉ gọi API usage khi được yêu cầu (bấm refresh)
  const list = loadAccounts();
  const accts = await Promise.all(list.map(async (a) => ({
    id: a.id, label: a.label, disabled: !!a.disabled,
    usage: withUsage ? await fetchUsage(a.configDir) : null,
  })));
  const cfg = store.getSettings();
  const enabledU = accts.filter((a) => !a.disabled);
  const active = (cfg.preferredAccount && enabledU.some((a) => a.id === cfg.preferredAccount))
    ? cfg.preferredAccount
    : (withUsage
        ? enabledU.slice().sort((x, y) => (x.usage?.fiveHourPct ?? 0) - (y.usage?.fiveHourPct ?? 0))[0]?.id
        : enabledU[0]?.id) || null;
  res.json({ active, preferred: cfg.preferredAccount || "", accounts: accts });
});

// ---- Thêm/xoá account + đăng nhập tự động qua UI ----
const logins = new Map(); // loginId -> { child, buf, id, label, configDir, done }

// Bắt đầu login: spawn `claude auth login`, bắt URL để user mở & lấy code.
app.post("/api/accounts/login/start", (req, res) => {
  const label = String(req.body.label || "Account").slice(0, 40);
  const id = "acc-" + Date.now().toString(36);
  const configDir = newAccountConfigDir(id);
  let child;
  try { child = spawn("claude", ["auth", "login", "--claudeai"], { env: { ...process.env, CLAUDE_CONFIG_DIR: configDir } }); }
  catch (e) { return res.status(500).json({ error: "Không chạy được claude: " + String(e.message) }); }

  const entry = { child, buf: "", id, label, configDir, done: false };
  logins.set(id, entry);
  let responded = false;
  const tryUrl = () => {
    const m = entry.buf.match(/https?:\/\/\S+/);
    if (m && !responded) { responded = true; res.json({ loginId: id, url: m[0], configDir }); }
  };
  child.stdout.on("data", (d) => { entry.buf += d.toString(); tryUrl(); });
  child.stderr.on("data", (d) => { entry.buf += d.toString(); tryUrl(); });
  child.on("error", (e) => { if (!responded) { responded = true; res.status(500).json({ error: String(e.message) }); } });
  child.on("close", (code) => { entry.done = true; entry.code = code; });
  // tự dọn nếu treo quá 5 phút
  setTimeout(() => { if (logins.has(id) && !logins.get(id).accountAdded) { try { child.kill(); } catch {} logins.delete(id); } }, 300000);
  setTimeout(() => { if (!responded) { responded = true; res.status(504).json({ error: "Không lấy được URL đăng nhập (xem terminal server).", loginId: id }); } }, 12000);
});

// Gửi code người dùng dán về → viết vào stdin → chờ login xong → thêm account.
app.post("/api/accounts/login/code", async (req, res) => {
  const entry = logins.get(req.body.loginId);
  if (!entry) return res.status(404).json({ error: "Phiên đăng nhập không tồn tại/đã hết hạn" });
  entry.buf = "";
  try { entry.child.stdin.write(String(req.body.code || "").trim() + "\n"); }
  catch (e) { return res.status(400).json({ error: "Không gửi được code: " + String(e.message) }); }

  await new Promise((resolve) => {
    if (entry.done) return resolve();
    entry.child.on("close", () => resolve());
    setTimeout(resolve, 20000);
  });

  if (await isLoggedIn(entry.configDir)) {
    entry.accountAdded = true;
    addAccount({ id: entry.id, label: entry.label, configDir: entry.configDir });
    logins.delete(req.body.loginId);
    broadcast({ type: "accounts:changed" });
    return res.json({ ok: true, account: { id: entry.id, label: entry.label } });
  }
  try { entry.child.kill(); } catch {}
  logins.delete(req.body.loginId);
  res.status(400).json({ error: "Đăng nhập chưa thành công — kiểm tra lại code.", log: entry.buf.slice(-300) });
});

// Thêm account đã login sẵn (trỏ tới configDir có credential).
app.post("/api/accounts", (req, res) => {
  const { id, label, configDir } = req.body;
  if (!id || !configDir) return res.status(400).json({ error: "Cần id và configDir" });
  if (!existsSync(configDir)) return res.status(400).json({ error: "configDir không tồn tại" });
  addAccount({ id, label, configDir });
  broadcast({ type: "accounts:changed" });
  res.json({ ok: true });
});

app.delete("/api/accounts/:id", (req, res) => {
  removeAccount(req.params.id);
  broadcast({ type: "accounts:changed" });
  res.json({ ok: true });
});

// Bật/tắt account (tắt = không dùng nữa, orchestrator bỏ qua).
app.patch("/api/accounts/:id", (req, res) => {
  setAccountEnabled(req.params.id, req.body.enabled !== false);
  broadcast({ type: "accounts:changed" });
  res.json({ ok: true });
});

// Lấy lại % usage + thông tin account thật (email/plan/org) cho 1 account.
app.get("/api/accounts/:id/usage", async (req, res) => {
  const acc = loadAccounts().find((a) => a.id === req.params.id);
  if (!acc) return res.status(404).json({ error: "Không thấy account" });
  const [usage, profile] = await Promise.all([fetchUsage(acc.configDir), fetchProfile(acc.configDir)]);
  res.json({ id: acc.id, usage, profile, configDir: acc.configDir });
});

// Model đang active thật của Claude (map động, không hard-code).
app.get("/api/models", async (req, res) => {
  const acc = enabledAccounts()[0] || loadAccounts()[0];
  const models = acc ? await fetchModels(acc.configDir) : [];
  res.json({ models });
});

// Cấu hình chung (model claude…).
app.get("/api/settings", (req, res) => res.json(store.getSettings()));
app.put("/api/settings", (req, res) => {
  const patch = {};
  if (typeof req.body.model === "string") patch.model = req.body.model.trim();
  if (typeof req.body.economy === "boolean") patch.economy = req.body.economy;
  if (req.body.maxBudgetUsd !== undefined) patch.maxBudgetUsd = Math.max(0, Number(req.body.maxBudgetUsd) || 0);
  if (typeof req.body.slackWebhook === "string") patch.slackWebhook = req.body.slackWebhook.trim();
  if (typeof req.body.preferredAccount === "string") patch.preferredAccount = req.body.preferredAccount;
  if (req.body.switchThreshold !== undefined) patch.switchThreshold = Math.min(100, Math.max(1, Number(req.body.switchThreshold) || 90));
  if (typeof req.body.allowCommands === "boolean") patch.allowCommands = req.body.allowCommands;
  res.json(store.setSettings(patch));
});

// Thông báo Slack (nếu đã cấu hình webhook). Desktop notification xử lý ở frontend.
async function notify(text) {
  const { slackWebhook } = store.getSettings();
  if (!slackWebhook) return;
  try {
    await fetch(slackWebhook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
  } catch { /* bỏ qua lỗi mạng */ }
}

// Thư viện skill tổng (.skill/) — xem & sửa trên UI.
app.get("/api/skills", (req, res) => { try { res.json(listSkills()); } catch (e) { res.status(500).json({ error: String(e.message) }); } });
app.put("/api/skills/:file", (req, res) => {
  try { res.json(saveSkill(req.params.file, req.body.content || "")); }
  catch (e) { res.status(400).json({ error: String(e.message) }); }
});

// Tài liệu của project (docsDir) — liệt kê / đọc / ghi từ UI.
app.get("/api/projects/:id/docs", (req, res) => {
  const p = store.getProject(req.params.id); if (!p) return res.status(404).json({ error: "Không thấy project" });
  const ws = resolveWorkspace(p.repo_path, p.name);
  res.json({ mode: ws.mode, docsDir: ws.docsDir, files: listDocs(ws.docsDir) });
});
app.get("/api/projects/:id/docs/file", (req, res) => {
  const p = store.getProject(req.params.id); if (!p) return res.status(404).json({ error: "Không thấy project" });
  const ws = resolveWorkspace(p.repo_path, p.name);
  try { res.json({ path: req.query.path, content: readDoc(ws.docsDir, req.query.path || "") }); }
  catch (e) { res.status(400).json({ error: String(e.message) }); }
});
app.put("/api/projects/:id/docs/file", (req, res) => {
  const p = store.getProject(req.params.id); if (!p) return res.status(404).json({ error: "Không thấy project" });
  const ws = resolveWorkspace(p.repo_path, p.name);
  try { res.json(writeDoc(ws.docsDir, req.body.path || "", req.body.content || "")); }
  catch (e) { res.status(400).json({ error: String(e.message) }); }
});

// Log hoạt động đã lưu của 1 project (để xem lại trên UI).
app.get("/api/projects/:id/logs", (req, res) => res.json(store.listLogs(req.params.id)));
app.delete("/api/projects/:id/logs", (req, res) => { store.clearLogs(req.params.id); res.json({ ok: true }); });

// ---- Session manager: nhiều feature chạy song song, persist + resume ----
function nodesPublic(s) {
  return ROLE_ORDER.map((id) => ({ id, ...ROLE_META[id], ...(s.nodes[id] || {}) }));
}
function sessionPublic(s) {
  return {
    id: s.id, projectId: s.projectId, projectName: s.projectName, feature: s.feature,
    roles: s.roles, model: s.model, economy: s.economy, maxBudgetUsd: s.maxBudgetUsd,
    status: s.status, activeAccount: s.activeAccount, startedAt: s.startedAt,
    requirementId: s.requirementId || null, saveLog: !!s.saveLog,
    error: s.error || null, resumable: s.status === "error" || s.status === "stopped",
    nodes: nodesPublic(s),
  };
}
// Lưu slim (đã serialize được) ra đĩa để sống sót qua restart + resume.
function persist(s) {
  store.saveSession({
    id: s.id, projectId: s.projectId, projectName: s.projectName, repoPath: s.repoPath,
    feature: s.feature, roles: s.roles, model: s.model, economy: s.economy, maxBudgetUsd: s.maxBudgetUsd,
    note: s.note || "", requirementId: s.requirementId || null, saveLog: !!s.saveLog,
    status: s.status, activeAccount: s.activeAccount, startedAt: s.startedAt, updatedAt: Date.now(),
    error: s.error || null, nodes: s.nodes,
  });
}
// Dựng lại session in-memory từ bản slim đã lưu.
function reconstruct(slim) {
  const nodes = {};
  for (const rid of ROLE_ORDER)
    nodes[rid] = slim.nodes?.[rid] || { status: slim.roles.includes(rid) ? "pending" : "disabled", activity: "" };
  return { ...slim, runSet: new Set(slim.roles), currentChild: null, cancelRequested: false, nodes };
}
const WATCH_MS = 45000; // chu kỳ theo dõi usage khi 1 node đang chạy

// Account đang BẬT khác (trừ exceptId) có % 5h thấp nhất VÀ dưới ngưỡng; null nếu không có.
async function bestOtherAccountBelow(exceptId, threshold) {
  const others = enabledAccounts().filter((a) => a.id !== exceptId);
  const scored = (await Promise.all(others.map(async (a) => ({
    id: a.id, pct: (await fetchUsage(a.configDir))?.fiveHourPct ?? 100,
  })))).filter((x) => x.pct < threshold).sort((a, b) => a.pct - b.pct);
  return scored[0]?.id || null;
}

// Account đang BẬT CHƯA thử (không nằm trong triedIds) có % 5h thấp nhất (còn nhiều token nhất); null nếu hết.
async function bestUntriedAccount(triedIds) {
  const others = enabledAccounts().filter((a) => !triedIds.has(a.id));
  if (!others.length) return null;
  const scored = await Promise.all(others.map(async (a) => ({
    id: a.id, pct: (await fetchUsage(a.configDir))?.fiveHourPct ?? 100,
  })));
  scored.sort((a, b) => a.pct - b.pct);
  return scored[0].id;
}

// Phân loại lỗi để gợi ý cách xử lý (login / hết quota-token / khác).
function classifyError(msg) {
  const m = String(msg).toLowerCase();
  if (/not logged in|please run \/login|unauthor|401|invalid api key|no auth/.test(m)) return "login";
  if (/quota|rate limit|429|usage limit|exhaust|insufficient|402|max[- ]?budget|budget/.test(m)) return "quota";
  return "unknown";
}

function pruneSessions() {
  if (sessions.size <= MAX_KEEP) return;
  const done = [...sessions.values()].filter((s) => s.status !== "running")
    .sort((a, b) => a.startedAt - b.startedAt);
  while (sessions.size > MAX_KEEP && done.length) { const s = done.shift(); sessions.delete(s.id); store.deleteSession(s.id); }
}

// Nạp lại session đã lưu khi khởi động; session "running" cũ coi như bị ngắt (process đã chết) -> cho resume.
for (const slim of store.listSessions()) {
  const s = reconstruct(slim);
  if (s.status === "running") {
    s.status = "stopped";
    s.error = { kind: "interrupted", message: "Server khởi động lại khi đang chạy — bấm Tiếp tục để chạy nốt." };
    for (const rid of s.roles) if (s.nodes[rid]?.status === "running") s.nodes[rid] = { ...s.nodes[rid], status: "pending" };
  }
  sessions.set(s.id, s);
}

app.get("/api/sessions", (req, res) => res.json([...sessions.values()].map(sessionPublic)));
// Log đã lưu của 1 session (nếu bật lưu log).
app.get("/api/sessions/:sid/logs", (req, res) => res.json(store.listSessionLogs(req.params.sid)));
// Bật/tắt lưu log cho 1 session (live).
app.patch("/api/sessions/:sid", (req, res) => {
  const s = sessions.get(req.params.sid);
  if (!s) return res.status(404).json({ error: "Không thấy session" });
  if (typeof req.body.saveLog === "boolean") { s.saveLog = req.body.saveLog; persist(s); }
  broadcast({ type: "session:init", session: s.id, data: sessionPublic(s) });
  res.json({ ok: true, saveLog: s.saveLog });
});

app.post("/api/projects/:id/run", (req, res) => {
  const project = store.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Không thấy project" });
  const feature = req.body.feature || "";
  const roles = Array.isArray(req.body.roles) && req.body.roles.length
    ? ROLE_ORDER.filter((r) => req.body.roles.includes(r)) : ROLE_ORDER;
  // override per-run (từ modal), fallback cấu hình chung
  const cfg = store.getSettings();
  const model = typeof req.body.model === "string" ? req.body.model.trim() : cfg.model;
  const economy = typeof req.body.economy === "boolean" ? req.body.economy : cfg.economy;
  const maxBudgetUsd = req.body.maxBudgetUsd !== undefined
    ? Math.max(0, Number(req.body.maxBudgetUsd) || 0) : cfg.maxBudgetUsd;

  // Nếu chạy để phân tích 1 requirement: gắn requirementId + dựng note kèm nội dung & file đính kèm.
  const requirementId = req.body.requirementId ? Number(req.body.requirementId) : null;
  const saveLog = req.body.saveLog === true; // mặc định tắt — chỉ lưu log khi user bật
  let note = typeof req.body.note === "string" ? req.body.note : "";
  if (requirementId) {
    const rq = store.getRequirement(requirementId);
    if (rq) {
      const files = (rq.files || []).map((f) => f.path).filter((p) => existsSync(p));
      note = `Đây là PHÂN TÍCH YÊU CẦU MỚI của khách hàng.\nNội dung requirement: "${rq.body}".`
        + (files.length ? `\nĐọc kỹ các file đính kèm (đường dẫn tuyệt đối): ${files.join(", ")}.` : "")
        + `\nPhân tích và cập nhật tài liệu tương ứng; nếu cần, đề xuất/bổ sung 1 feature gấp trong kế hoạch để đáp ứng requirement này.`
        + (req.body.note ? `\nGhi chú thêm: ${req.body.note}` : "");
    }
  }

  const runSet = new Set(roles);
  const nodes = {};
  for (const rid of ROLE_ORDER) nodes[rid] = { status: runSet.has(rid) ? "pending" : "disabled", activity: "" };
  // bắt đầu từ account mặc định nếu đã đặt & đang bật (pickAccount giữ nó tới khi chạm ngưỡng)
  const startAccount = cfg.preferredAccount && enabledAccounts().some((a) => a.id === cfg.preferredAccount)
    ? cfg.preferredAccount : null;
  const s = {
    id: "s" + Date.now().toString(36) + (++SEQ), projectId: project.id, projectName: project.name,
    repoPath: project.repo_path, feature, roles, runSet, model, economy, maxBudgetUsd,
    note, requirementId, saveLog,
    status: "running", activeAccount: startAccount, currentChild: null, cancelRequested: false,
    startedAt: Date.now(), nodes,
  };
  sessions.set(s.id, s);
  persist(s);
  pruneSessions();
  res.json({ ok: true, session: sessionPublic(s) });
  broadcast({ type: "session:init", session: s.id, data: sessionPublic(s) });
  launch(s);
});

function launch(s, resume = false) {
  runSession(s, resume).catch((e) => {
    s.status = "error"; s.error = { kind: classifyError(e.message), message: String(e.message) };
    persist(s);
    broadcast({ type: "flow:error", session: s.id, message: String(e.message) });
  });
}

// Tạm dừng 1 session cụ thể: kill claude của session đó + dừng vòng lặp của nó.
app.post("/api/sessions/:sid/stop", (req, res) => {
  const s = sessions.get(req.params.sid);
  if (!s) return res.status(404).json({ error: "Không thấy session" });
  s.cancelRequested = true;
  if (s.currentChild) { try { s.currentChild.kill("SIGTERM"); } catch {} }
  broadcast({ type: "flow:stopping", session: s.id });
  res.json({ ok: true });
});

// Xoá 1 session (dọn card). Nếu đang chạy thì kill trước.
app.delete("/api/sessions/:sid", (req, res) => {
  const s = sessions.get(req.params.sid);
  if (s) {
    s.cancelRequested = true;
    if (s.currentChild) { try { s.currentChild.kill("SIGTERM"); } catch {} }
    sessions.delete(s.id);
  }
  store.deleteSession(req.params.sid);
  broadcast({ type: "session:removed", session: req.params.sid });
  res.json({ ok: true });
});

// Tiếp tục 1 session lỗi/đã dừng: chạy nốt các node CHƯA "done" (sau khi đã /login, đổi account, đợi quota reset…).
app.post("/api/sessions/:sid/resume", (req, res) => {
  const s = sessions.get(req.params.sid);
  if (!s) return res.status(404).json({ error: "Không thấy session" });
  if (s.status === "running") return res.status(400).json({ error: "Session đang chạy" });
  s.status = "running"; s.cancelRequested = false; s.error = null;
  for (const rid of s.roles) if (s.nodes[rid]?.status !== "done") s.nodes[rid] = { ...s.nodes[rid], status: "pending", activity: "" };
  persist(s);
  res.json({ ok: true, session: sessionPublic(s) });
  broadcast({ type: "session:init", session: s.id, data: sessionPublic(s) });
  launch(s, true);
});

// Chọn account cho 1 session (auto-switch khi gần cạn). Mỗi session giữ account riêng.
async function ensureAccountFor(s) {
  const accounts = enabledAccounts();
  if (!accounts.length) throw new Error("Không có account nào được BẬT — vào sidebar bật lại ít nhất 1 account.");
  const threshold = store.getSettings().switchThreshold || 90;
  const { chosen, all, switched, exhausted } = await pickAccount(accounts, s.activeAccount, threshold);
  if (exhausted) {
    broadcast({ type: "account:exhausted", session: s.id, accounts: all.map(a => ({ id: a.id, usage: a.usage })) });
    notify(`⚠ [${s.projectName}] các account gần cạn quota khi chạy "${s.feature}".`);
  }
  if (switched || s.activeAccount !== chosen.id) {
    s.activeAccount = chosen.id;
    broadcast({ type: "account:switched", session: s.id, to: chosen.id, label: chosen.label, usage: chosen.usage });
  }
  return chosen;
}

async function runSession(s, resume = false) {
  const isFull = s.runSet.size === ROLE_ORDER.length; // auto-skip chỉ cho full luồng
  const run = store.startRun(s.projectId, s.feature, null);

  const emit = (msg) => broadcast({ ...msg, session: s.id });
  const setNode = (id, patch) => { s.nodes[id] = { ...s.nodes[id], ...patch }; };
  const flog = (entry) => {
    broadcast({ type: "log", session: s.id, project: s.projectId, ...entry });
    if (s.saveLog) store.appendSessionLog(s.id, entry); // chỉ lưu khi bật
  };

  flog({ role: "flow", roleName: "Flow", emoji: resume ? "▶️" : "🚀", kind: "start",
    text: (resume ? "Tiếp tục" : "Bắt đầu") + ` feature: ${s.feature} · mode: [${s.roles.join(" → ")}]` });
  flog({ role: "flow", roleName: "Flow", emoji: "🧠", kind: "info",
    text: `Model: ${s.model || "mặc định"} · Tiết kiệm: ${s.economy ? "bật" : "tắt"}`
      + (s.maxBudgetUsd > 0 ? ` · trần $${s.maxBudgetUsd}/node` : "") });

  let ws = { docsDir: join(s.repoPath, "document"), mode: "repo", created: [] };
  try {
    ws = resolveWorkspace(s.repoPath, s.projectName);
    flog({ role: "flow", roleName: "Skill", emoji: "📁", kind: "info",
      text: ws.mode === "repo" ? `Dùng tài liệu sẵn có: ${ws.docsDir}`
        : `Sinh bộ agile chuẩn (ngoài repo): ${ws.docsDir}` + (ws.created.length ? ` · tạo: ${ws.created.join(", ")}` : "") });
  } catch (e) {
    flog({ role: "flow", roleName: "Skill", emoji: "📁", kind: "error", text: "Lỗi workspace: " + String(e.message) });
  }

  for (const roleId of ROLE_ORDER) {
    if (s.cancelRequested) break;
    const meta = ROLE_META[roleId];

    if (!s.runSet.has(roleId)) continue;                    // ngoài mode
    if (s.nodes[roleId]?.status === "done") continue;       // đã xong (resume: bỏ qua, chạy tiếp phần còn lại)

    if (s.economy && isFull && roleHasOutputs(roleId, s.feature, ws.docsDir)) {
      setNode(roleId, { status: "disabled", activity: "♻️ đã có" });
      emit({ type: "node:skipped", id: roleId });
      flog({ role: roleId, roleName: meta.name, emoji: meta.emoji, kind: "skip", text: "♻️ đã có tài liệu — bỏ qua để tiết kiệm token" });
      continue;
    }

    const prompt = buildRolePrompt(roleId, s.feature, roleId === s.roles[0], { ...ws, note: s.note });
    let nodeDone = false, attempt = 0, forced = null;
    const tried = new Set(); // account đã thử cho node này (để biết khi nào hết account)
    while (!nodeDone) {
      if (s.cancelRequested) break;
      attempt++;
      const threshold = store.getSettings().switchThreshold || 90;
      // dùng đúng account bị "ép" (sau khi đổi vì rate-limit) nếu có, không thì để pickAccount chọn
      let account = forced ? enabledAccounts().find((a) => a.id === forced) : null;
      forced = null;
      if (account) s.activeAccount = account.id; else account = await ensureAccountFor(s);
      tried.add(account.id);
      setNode(roleId, { status: "running", account: account.id, activity: attempt > 1 ? "↻ đổi account, chạy lại…" : "…" });
      persist(s);
      emit({ type: "node:start", id: roleId, account: account.id });
      flog({ role: roleId, roleName: meta.name, emoji: meta.emoji, kind: "start",
        text: `▶ bắt đầu (acct: ${account.id})` + (attempt > 1 ? " [chạy lại sau khi đổi account]" : "") });

      // Watchdog: đang chạy mà account sắp cạn (≥ ngưỡng) & có account khác đỡ hơn -> kill để đổi.
      let switchTo = null;
      const watch = setInterval(async () => {
        try {
          const u = await fetchUsage(account.configDir);
          if (u?.fiveHourPct != null && u.fiveHourPct >= threshold) {
            const next = await bestOtherAccountBelow(account.id, threshold);
            if (next) {
              switchTo = next; clearInterval(watch);
              flog({ role: roleId, roleName: meta.name, emoji: "⚡", kind: "info",
                text: `${account.id} sắp cạn (${Math.round(u.fiveHourPct)}%) — tạm dừng node, đổi sang ${next} rồi chạy lại` });
              try { s.currentChild?.kill("SIGTERM"); } catch {}
            }
          }
        } catch { /* bỏ qua lỗi đọc usage */ }
      }, WATCH_MS);

      try {
        await runClaude({
          prompt, cwd: s.repoPath, configDir: account.configDir, model: s.model, maxBudgetUsd: s.maxBudgetUsd,
          allowCommands: store.getSettings().allowCommands !== false,
          onSpawn: (c) => { s.currentChild = c; },
          onEvent: (d) => {
            setNode(roleId, { activity: d.text });
            emit({ type: "node:activity", id: roleId, ...d });
            flog({ role: roleId, roleName: meta.name, emoji: meta.emoji, kind: d.kind, text: d.text });
          },
        });
        clearInterval(watch); s.currentChild = null;
        setNode(roleId, { status: "done", activity: "✓ hoàn tất" });
        persist(s);
        emit({ type: "node:done", id: roleId });
        flog({ role: roleId, roleName: meta.name, emoji: meta.emoji, kind: "done", text: "✓ hoàn tất" });
        nodeDone = true;
      } catch (e) {
        clearInterval(watch); s.currentChild = null;
        if (s.cancelRequested) { // user tạm dừng
          setNode(roleId, { status: "pending", activity: "⏸ đã dừng" });
          s.status = "stopped"; persist(s);
          emit({ type: "node:stopped", id: roleId });
          flog({ role: roleId, roleName: meta.name, emoji: meta.emoji, kind: "stopped", text: "⏸ đã tạm dừng" });
          emit({ type: "flow:stopped" }); store.finishRun(run.lastInsertRowid, "stopped");
          return;
        }
        const kind = classifyError(e.message);
        // Rate-limit/quota (hoặc watchdog yêu cầu đổi): thử account khác còn nhiều token, CHƯA thử.
        if (switchTo || kind === "quota") {
          const next = (switchTo && !tried.has(switchTo)) ? switchTo : await bestUntriedAccount(tried);
          if (next) {
            forced = next; s.activeAccount = next;
            emit({ type: "account:switched", session: s.id, to: next });
            flog({ role: roleId, roleName: meta.name, emoji: "↻", kind: "info",
              text: `${account.id} ${switchTo ? "sắp cạn" : "rate-limit"} — đổi sang ${next} (còn nhiều token) rồi chạy lại` });
            continue; // chạy lại node với account mới
          }
          // Đã thử HẾT account mà vẫn rate-limit -> TẠM DỪNG (resume được khi quota reset / thêm account).
          setNode(roleId, { status: "pending", activity: "⏸ hết account còn token" });
          s.status = "stopped";
          s.error = { kind: "quota", roleId, message: "Đã thử tất cả account mà vẫn rate-limit — tạm dừng. Bấm Tiếp tục khi quota reset hoặc thêm account." };
          persist(s);
          emit({ type: "node:stopped", id: roleId });
          flog({ role: roleId, roleName: meta.name, emoji: "⏸", kind: "stopped",
            text: `Hết account còn token (đã thử: ${[...tried].join(", ")}) — tạm dừng luồng` });
          emit({ type: "flow:stopped" });
          store.finishRun(run.lastInsertRowid, "stopped");
          notify(`⏸ [${s.projectName}] "${s.feature}" tạm dừng: hết account còn token (rate-limit) ở ${meta.name}.`);
          return;
        }
        // Lỗi khác (login/unknown) -> báo lỗi như cũ.
        setNode(roleId, { status: "error", activity: "✖ " + String(e.message) });
        s.status = "error"; s.error = { kind, message: String(e.message), roleId };
        persist(s);
        emit({ type: "node:error", id: roleId, message: String(e.message), errorKind: kind });
        flog({ role: roleId, roleName: meta.name, emoji: meta.emoji, kind: "error",
          text: "✖ " + hintFor(kind) + String(e.message).slice(0, 200) });
        store.finishRun(run.lastInsertRowid, "error");
        notify(`✖ [${s.projectName}] "${s.feature}" LỖI ở ${meta.name} (${kind}).`);
        return;
      }
    }
    if (s.cancelRequested) break;
  }

  if (s.cancelRequested) { // dừng giữa 2 node (break ở đầu vòng lặp)
    s.status = "stopped"; store.finishRun(run.lastInsertRowid, "stopped"); persist(s);
    flog({ role: "flow", roleName: "Flow", emoji: "⏸", kind: "stopped", text: "Đã tạm dừng" });
    emit({ type: "flow:stopped" }); return;
  }

  s.status = "done";
  store.finishRun(run.lastInsertRowid, "done");
  // học từ mọi node đã hoàn tất (kể cả phần done từ lượt trước khi resume)
  const completed = s.roles.filter((r) => s.nodes[r]?.status === "done");
  try {
    if (completed.length) {
      const learned = learnFromRun(s.projectName, s.feature, completed, "done");
      flog({ role: "flow", roleName: "Skill", emoji: "🧩", kind: "info", text: `Học vào skill tổng: ${learned.join(", ")}` });
    }
  } catch { /* không chặn */ }
  // Nếu chạy để giải quyết 1 requirement -> tự đánh dấu đã giải quyết.
  if (s.requirementId) {
    try {
      store.setRequirementStatus(s.requirementId, "resolved");
      broadcast({ type: "requirement:updated", projectId: s.projectId });
      flog({ role: "flow", roleName: "Requirement", emoji: "✅", kind: "info",
        text: `Đánh dấu requirement #${s.requirementId} = đã giải quyết` });
    } catch { /* bỏ qua */ }
  }
  persist(s);
  flog({ role: "flow", roleName: "Flow", emoji: "🏁", kind: "done", text: "Hoàn tất" });
  emit({ type: "flow:done" });
  notify(`✅ [${s.projectName}] "${s.feature}" hoàn tất (mode ${s.roles.join("→")}).`);
}

// Gợi ý ngắn kèm lỗi để người dùng biết cách xử lý trước khi bấm Tiếp tục.
function hintFor(kind) {
  if (kind === "login") return "[Cần đăng nhập: chạy `claude /login` cho account rồi Tiếp tục] ";
  if (kind === "quota") return "[Hết quota/ngân sách token: đợi reset hoặc thêm/đổi account rồi Tiếp tục] ";
  return "";
}

const PORT = 4311;
http.listen(PORT, () => console.log(`Agile Studio API + WS: http://localhost:${PORT}`));
