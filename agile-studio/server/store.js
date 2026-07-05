// Lưu project + requirement vào JSON file (~/.agile-studio/studio.json).
// App local 1 người dùng nên không cần DBMS; tránh native compile.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const DIR = join(homedir(), ".agile-studio");
mkdirSync(DIR, { recursive: true });
const FILE = join(DIR, "studio.json");

function read() {
  if (!existsSync(FILE)) return { projects: [], requirements: [], runs: [], logs: {}, sessions: {}, seq: 1 };
  const d = JSON.parse(readFileSync(FILE, "utf8"));
  if (!d.logs) d.logs = {};         // migrate file cũ
  if (!d.sessions) d.sessions = {};
  if (!d.sessionLogs) d.sessionLogs = {};
  if (!d.schedules) d.schedules = {};
  return d;
}
function write(d) { writeFileSync(FILE, JSON.stringify(d, null, 2)); }
function nextId(d) { return d.seq++; }

export const store = {
  listProjects() { return read().projects.slice().reverse(); },
  addProject(name, repo_path) {
    const d = read();
    if (d.projects.some((p) => p.repo_path === repo_path)) throw new Error("Repo đã tồn tại");
    const id = nextId(d);
    d.projects.push({ id, name, repo_path, created_at: new Date().toISOString() });
    write(d); return { lastInsertRowid: id };
  },
  getProject(id) { return read().projects.find((p) => p.id === Number(id)); },

  listRequirements(pid) {
    return read().requirements.filter((r) => r.project_id === Number(pid))
      .sort((a, b) => (b.day + b.created_at).localeCompare(a.day + a.created_at));
  },
  addRequirement(pid, day, body) {
    const d = read(); const id = nextId(d);
    d.requirements.push({ id, project_id: Number(pid), day, body,
      status: "open", files: [], created_at: new Date().toISOString() });
    write(d); return { lastInsertRowid: id };
  },
  getRequirement(id) { return read().requirements.find((r) => r.id === Number(id)); },
  setRequirementStatus(id, status) {
    const d = read(); const r = d.requirements.find((x) => x.id === Number(id));
    if (r) { r.status = status; r.resolved_at = status === "resolved" ? new Date().toISOString() : null; write(d); }
    return r;
  },
  addRequirementFile(id, meta) {
    const d = read(); const r = d.requirements.find((x) => x.id === Number(id));
    if (r) { (r.files ||= []).push(meta); write(d); }
    return r;
  },
  removeRequirementFile(id, idx) {
    const d = read(); const r = d.requirements.find((x) => x.id === Number(id));
    if (r && r.files && r.files[idx]) { const [f] = r.files.splice(idx, 1); write(d); return f; }
    return null;
  },
  deleteRequirement(id) {
    const d = read(); d.requirements = d.requirements.filter((r) => r.id !== Number(id)); write(d);
  },

  startRun(pid, feature, accountId) {
    const d = read(); const id = nextId(d);
    d.runs.push({ id, project_id: Number(pid), feature, account_id: accountId,
      status: "running", started_at: new Date().toISOString() });
    write(d); return { lastInsertRowid: id };
  },
  finishRun(id, status) {
    const d = read(); const r = d.runs.find((x) => x.id === id);
    if (r) { r.status = status; r.finished_at = new Date().toISOString(); write(d); }
  },

  // Log hoạt động theo từng project (persist để xem lại trên UI).
  listLogs(pid) { return read().logs[String(pid)] || []; },
  appendLog(pid, entry) {
    const d = read(); const key = String(pid);
    const arr = d.logs[key] || (d.logs[key] = []);
    arr.push({ t: new Date().toISOString(), ...entry });
    if (arr.length > 500) d.logs[key] = arr.slice(-500); // cap tránh phình file
    write(d);
  },
  clearLogs(pid) { const d = read(); delete d.logs[String(pid)]; write(d); },

  // Session (persist để sống sót qua restart + resume). Lưu dạng slim đã serialize sẵn.
  listSessions() { return Object.values(read().sessions || {}); },
  saveSession(slim) {
    const d = read(); (d.sessions ||= {})[slim.id] = slim;
    // cap: giữ 60 session gần nhất theo updatedAt
    const arr = Object.values(d.sessions).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (arr.length > 60) d.sessions = Object.fromEntries(arr.slice(0, 60).map((s) => [s.id, s]));
    write(d);
  },
  deleteSession(id) { const d = read(); if (d.sessions) delete d.sessions[id]; if (d.sessionLogs) delete d.sessionLogs[id]; write(d); },

  // Log của RIÊNG 1 session (chỉ lưu khi session bật "lưu log").
  listSessionLogs(id) { return read().sessionLogs?.[id] || []; },
  appendSessionLog(id, entry) {
    const d = read(); const arr = (d.sessionLogs ||= {})[id] || (d.sessionLogs[id] = []);
    arr.push({ t: new Date().toISOString(), ...entry });
    if (arr.length > 1000) d.sessionLogs[id] = arr.slice(-1000);
    write(d);
  },

  // Lịch chạy feature (schedule).
  listSchedules() { return Object.values(read().schedules || {}); },
  getSchedule(id) { return read().schedules?.[id]; },
  saveSchedule(sc) { const d = read(); (d.schedules ||= {})[sc.id] = sc; write(d); return sc; },
  deleteSchedule(id) { const d = read(); if (d.schedules) delete d.schedules[id]; write(d); },

  // Cấu hình chung (model + tiết kiệm token).
  getSettings() {
    const s = read().settings || {};
    return { model: s.model || "", economy: s.economy !== false, maxBudgetUsd: Number(s.maxBudgetUsd) || 0,
      slackWebhook: s.slackWebhook || "", discordWebhook: s.discordWebhook || "",
      preferredAccount: s.preferredAccount || "",
      switchThreshold: Number(s.switchThreshold) || 90, allowCommands: s.allowCommands !== false };
  },
  setSettings(patch) {
    const d = read(); d.settings = { ...(d.settings || {}), ...patch }; write(d);
    return this.getSettings();
  },
};
