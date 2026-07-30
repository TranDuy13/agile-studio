// Docgen storage — deliberately standalone.
//
// It owns <DATA_DIR>/docgen.json and imports nothing from store.js. Reason: the docgen branch
// targets `main`, where storage is a single 124-line JSON file, while a pluggable-storage change
// is still in review. Keeping docgen in its own file means it runs unchanged on both, and touches
// zero lines of existing storage code. When the pluggable store lands, only the read/write pair
// below is swapped for an adapter — the API stays put.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// Same data directory as store.js. Branches that have the .env config module win over the default.
let DIR = join(homedir(), ".agile-studio");
try {
  const cfg = await import("../config.js");
  if (cfg?.config?.dataDir) DIR = cfg.config.dataDir;
} catch { /* no config module on this branch — keep the default */ }

mkdirSync(DIR, { recursive: true });
const FILE = join(DIR, "docgen.json");
// Scratch space for agent output. Never inside the project repo: a survey must not dirty it.
export const WORK_DIR = join(DIR, "docgen-work");

const empty = () => ({
  jobs: {}, plans: {}, ir: {}, scores: {}, findings: {}, exports: {},
  presets: {}, templates: {}, profiles: {}, tools: {},
  settings: { tokenThreshold: 50000, dontAsk: {}, tokensPer5h: 2000000 },
  seq: 1,
});

// Everything lives under a single root key, so a future move into the shared store is one splice.
let data = empty();
let loadError = null;
// Guards against a second process (a seed script, a second `npm run dev`) owning the same file:
// we remember the mtime we last wrote, and ids we deleted on purpose.
let lastMtime = 0;
const deletedIds = new Set();

const mtimeNow = () => { try { return statSync(FILE).mtimeMs; } catch { return 0; } };

const BAGS = ["jobs", "plans", "ir", "scores", "findings", "exports", "presets", "templates", "profiles"];

// Someone else wrote the file since our last write: keep their rows we do not know about instead
// of flattening them. Our own copy wins for ids we both have — we are the process the user is
// currently talking to.
function mergeFromDisk() {
  let disk;
  try { disk = JSON.parse(readFileSync(FILE, "utf8"))?.docgen; } catch { return; }
  if (!disk || typeof disk !== "object") return;
  let added = 0;
  for (const bag of BAGS) {
    const theirs = disk[bag] || {};
    for (const [k, v] of Object.entries(theirs))
      if (!(k in data[bag]) && !deletedIds.has(k)) { data[bag][k] = v; added++; }
  }
  data.seq = Math.max(Number(data.seq) || 1, Number(disk.seq) || 1);
  data.settings = { ...(disk.settings || {}), ...data.settings };
  console.warn(`[docgen] ${FILE} bị tiến trình khác ghi (có thể đang chạy hai server, hoặc vừa chạy seed). `
    + `Đã trộn ${added} bản ghi lạ vào thay vì ghi đè.`);
}

function load() {
  if (!existsSync(FILE)) return;                       // first run: empty is correct, not an error
  try {
    const raw = JSON.parse(readFileSync(FILE, "utf8"));
    const d = raw?.docgen && typeof raw.docgen === "object" ? raw.docgen : null;
    if (!d) throw new Error("thiếu khoá gốc \"docgen\"");
    data = { ...empty(), ...d, settings: { ...empty().settings, ...(d.settings || {}) } };
  } catch (e) {
    // Never overwrite a file we failed to parse — move it aside so the user can recover it by hand.
    const bak = FILE + ".bak";
    try { renameSync(FILE, bak); } catch { /* keep going even if the rename fails */ }
    loadError = `Không đọc được ${FILE}: ${e.message}. Đã đổi tên thành ${bak}; docgen khởi động với dữ liệu rỗng.`;
    console.error("[docgen] " + loadError);
    data = empty();
  }
}
load();
lastMtime = mtimeNow();

let timer = null, dirty = false;
function flush() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!dirty) return;
  dirty = false;
  const m = mtimeNow();
  if (m && lastMtime && m !== lastMtime) mergeFromDisk();
  try {
    writeFileSync(FILE, JSON.stringify({ docgen: data }, null, 2));
    lastMtime = mtimeNow();
  } catch (e) { console.error("[docgen] không ghi được " + FILE + ": " + e.message); }
}
// Debounced write: a wizard or a drag-and-drop reorder mutates many times per second.
function persist() {
  dirty = true;
  if (timer) return;
  timer = setTimeout(flush, 300);
}
process.on("exit", flush);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { flush(); process.exit(0); });

const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
const nextId = (prefix) => prefix + (data.seq++).toString(36) + Date.now().toString(36).slice(-4);

export const docgenStore = {
  status() { return { file: FILE, workDir: WORK_DIR, error: loadError }; },

  // ---- jobs ----
  listJobs(projectId) {
    const all = Object.values(data.jobs);
    const rows = projectId == null ? all : all.filter((j) => Number(j.projectId) === Number(projectId));
    return clone(rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
  },
  getJob(id) { return clone(data.jobs[id]) || null; },
  createJob(job) {
    const id = nextId("dj");
    data.jobs[id] = { ...job, id, status: job.status || "draft", createdAt: Date.now(), updatedAt: Date.now() };
    persist();
    return clone(data.jobs[id]);
  },
  patchJob(id, patch) {
    const j = data.jobs[id];
    if (!j) return null;
    data.jobs[id] = { ...j, ...patch, id, updatedAt: Date.now() };
    persist();
    return clone(data.jobs[id]);
  },
  deleteJob(id) {
    if (!data.jobs[id]) return false;
    delete data.jobs[id];
    deletedIds.add(id);
    for (const bag of [data.plans, data.ir, data.scores, data.findings, data.exports]) delete bag[id];
    persist();
    return true;
  },

  // ---- plans (the outline; frozen once approved) ----
  getPlan(jobId) { return clone(data.plans[jobId]) || null; },
  putPlan(jobId, plan) {
    const prev = data.plans[jobId];
    data.plans[jobId] = { revision: 1, ...prev, ...plan, updatedAt: Date.now() };
    persist();
    return clone(data.plans[jobId]);
  },
  bumpRevision(jobId) {
    const p = data.plans[jobId];
    if (!p) return null;
    p.revision = (p.revision || 1) + 1;
    persist();
    return clone(p);
  },
  approvePlan(jobId, { engine, estTokens }) {
    const p = data.plans[jobId];
    if (!p) return null;
    p.approvedAt = Date.now();
    p.engine = engine || p.engine || "per-doc";
    if (estTokens != null) p.estTokens = estTokens;
    // Sections switched off at approval time are frozen as skipped: the denominator of every
    // progress number from here on is the set of enabled sections.
    for (const d of p.docs || [])
      for (const s of d.sections || []) s.status = s.enabled === false ? "skipped" : (s.status || "pending");
    persist();
    return clone(p);
  },

  // ---- presets (studio-wide, reusable across projects) ----
  listPresets() { return clone(Object.values(data.presets).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))); },
  getPreset(id) { return clone(data.presets[id]) || null; },
  savePreset(preset) {
    const id = preset.id && data.presets[preset.id] ? preset.id : nextId("dp");
    data.presets[id] = { ...data.presets[id], ...preset, id, createdAt: data.presets[id]?.createdAt || Date.now() };
    persist();
    return clone(data.presets[id]);
  },
  deletePreset(id) {
    if (!data.presets[id]) return false;
    delete data.presets[id]; deletedIds.add(id); persist(); return true;
  },

  // ---- settings (token threshold + "đừng hỏi lại" per kind of work) ----
  getSettings() { return clone(data.settings); },
  setSettings(patch) {
    data.settings = { ...data.settings, ...patch, dontAsk: { ...data.settings.dontAsk, ...(patch.dontAsk || {}) } };
    persist();
    return clone(data.settings);
  },

  // Test hook: force the debounced write to happen now.
  flush,
};
