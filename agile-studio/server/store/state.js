// In-memory domain model + the store method surface. Backends (json/sqlite/postgres)
// only load this shape once and persist it back; all reads/writes here are synchronous
// so callers (server/index.js) stay unchanged. `save()` schedules a persist after mutations.

export function emptyData() {
  return { projects: [], requirements: [], runs: [], logs: {}, sessions: {},
    sessionLogs: {}, schedules: {}, settings: {}, seq: 1 };
}

// Fill any missing top-level keys so an older/partial snapshot is safe to use.
export function normalizeData(d) {
  const e = emptyData();
  return { ...e, ...d,
    logs: d.logs || {}, sessions: d.sessions || {}, sessionLogs: d.sessionLogs || {},
    schedules: d.schedules || {}, settings: d.settings || {}, seq: d.seq || 1 };
}

// Settings defaults, shared so every backend returns the same normalized shape.
export function normalizeSettings(s = {}) {
  return { model: s.model || "", economy: s.economy !== false, maxBudgetUsd: Number(s.maxBudgetUsd) || 0,
    slackWebhook: s.slackWebhook || "", discordWebhook: s.discordWebhook || "",
    preferredAccount: s.preferredAccount || "",
    switchThreshold: Number(s.switchThreshold) || 90, allowCommands: s.allowCommands !== false };
}

// Build the store object over an in-memory `data` snapshot. `save` is called after every
// mutation to schedule persistence (debounced by the caller).
export function makeStore(data, save) {
  const nextId = () => data.seq++;
  const w = (ret) => { save(); return ret; }; // mutate then schedule persist

  return {
    listProjects() { return data.projects.slice().reverse(); },
    addProject(name, repo_path) {
      if (data.projects.some((p) => p.repo_path === repo_path)) throw new Error("Repo đã tồn tại");
      const id = nextId();
      data.projects.push({ id, name, repo_path, created_at: new Date().toISOString() });
      return w({ lastInsertRowid: id });
    },
    getProject(id) { return data.projects.find((p) => p.id === Number(id)); },

    listRequirements(pid) {
      return data.requirements.filter((r) => r.project_id === Number(pid))
        .sort((a, b) => (b.day + b.created_at).localeCompare(a.day + a.created_at));
    },
    addRequirement(pid, day, body) {
      const id = nextId();
      data.requirements.push({ id, project_id: Number(pid), day, body,
        status: "open", files: [], created_at: new Date().toISOString() });
      return w({ lastInsertRowid: id });
    },
    getRequirement(id) { return data.requirements.find((r) => r.id === Number(id)); },
    setRequirementStatus(id, status) {
      const r = data.requirements.find((x) => x.id === Number(id));
      if (r) { r.status = status; r.resolved_at = status === "resolved" ? new Date().toISOString() : null; save(); }
      return r;
    },
    addRequirementFile(id, meta) {
      const r = data.requirements.find((x) => x.id === Number(id));
      if (r) { (r.files ||= []).push(meta); save(); }
      return r;
    },
    removeRequirementFile(id, idx) {
      const r = data.requirements.find((x) => x.id === Number(id));
      if (r && r.files && r.files[idx]) { const [f] = r.files.splice(idx, 1); save(); return f; }
      return null;
    },
    deleteRequirement(id) {
      data.requirements = data.requirements.filter((r) => r.id !== Number(id)); save();
    },

    startRun(pid, feature, accountId) {
      const id = nextId();
      data.runs.push({ id, project_id: Number(pid), feature, account_id: accountId,
        status: "running", started_at: new Date().toISOString() });
      return w({ lastInsertRowid: id });
    },
    finishRun(id, status) {
      const r = data.runs.find((x) => x.id === id);
      if (r) { r.status = status; r.finished_at = new Date().toISOString(); save(); }
    },

    // Per-project activity log (persisted so the UI can show history).
    listLogs(pid) { return data.logs[String(pid)] || []; },
    appendLog(pid, entry) {
      const key = String(pid);
      const arr = data.logs[key] || (data.logs[key] = []);
      arr.push({ t: new Date().toISOString(), ...entry });
      if (arr.length > 500) data.logs[key] = arr.slice(-500); // cap to keep the snapshot small
      save();
    },
    clearLogs(pid) { delete data.logs[String(pid)]; save(); },

    // Sessions (persisted to survive restart + resume). Stored as pre-serialized slim objects.
    listSessions() { return Object.values(data.sessions || {}); },
    saveSession(slim) {
      (data.sessions ||= {})[slim.id] = slim;
      const arr = Object.values(data.sessions).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      if (arr.length > 60) data.sessions = Object.fromEntries(arr.slice(0, 60).map((s) => [s.id, s])); // keep 60 newest
      save();
    },
    deleteSession(id) {
      if (data.sessions) delete data.sessions[id];
      if (data.sessionLogs) delete data.sessionLogs[id];
      save();
    },

    // Per-session log (only stored when the session has logging enabled).
    listSessionLogs(id) { return data.sessionLogs?.[id] || []; },
    appendSessionLog(id, entry) {
      const arr = (data.sessionLogs ||= {})[id] || (data.sessionLogs[id] = []);
      arr.push({ t: new Date().toISOString(), ...entry });
      if (arr.length > 1000) data.sessionLogs[id] = arr.slice(-1000);
      save();
    },

    // Scheduled feature runs.
    listSchedules() { return Object.values(data.schedules || {}); },
    getSchedule(id) { return data.schedules?.[id]; },
    saveSchedule(sc) { (data.schedules ||= {})[sc.id] = sc; return w(sc); },
    deleteSchedule(id) { if (data.schedules) delete data.schedules[id]; save(); },

    // Global settings (model + token economy, webhooks, account prefs).
    getSettings() { return normalizeSettings(data.settings || {}); },
    setSettings(patch) {
      data.settings = { ...(data.settings || {}), ...patch }; save();
      return this.getSettings();
    },
  };
}
