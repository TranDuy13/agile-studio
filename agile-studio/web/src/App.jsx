import React, { useEffect, useState, useRef, useCallback } from "react";
import Canvas from "./Canvas.jsx";
import Requirements from "./Requirements.jsx";
import AccountBadge from "./AccountBadge.jsx";
import RunModal from "./RunModal.jsx";
import SessionCard from "./SessionCard.jsx";
import DocsPanel from "./DocsPanel.jsx";
import SettingsModal from "./SettingsModal.jsx";
import AddProjectModal from "./AddProjectModal.jsx";
import ScheduleTab from "./ScheduleTab.jsx";
import { ROLE_ORDER, ROLE_META, presetOf } from "./presets.js";

// Thông báo desktop (nếu user bật + đã cấp quyền).
function desktopNotify(title, body) {
  try {
    if (localStorage.getItem("notifyDesktop") === "1" && "Notification" in window && Notification.permission === "granted")
      new Notification(title, { body });
  } catch { /* bỏ qua */ }
}

// nodes trả từ server là mảng -> chuyển sang map theo role id để cập nhật/render tiện.
const normSession = (d) => ({ ...d, nodes: Object.fromEntries((d.nodes || []).map((n) => [n.id, n])), logs: [] });

export default function App() {
  const [projects, setProjects] = useState([]);
  const [active, setActive] = useState(null);
  const [tab, setTab] = useState("flow");
  const [sessions, setSessions] = useState({});      // id -> session (nhiều session song song)
  const [selectedId, setSelectedId] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addProjOpen, setAddProjOpen] = useState(false);
  const [modalPrefill, setModalPrefill] = useState(null);
  const [reqVersion, setReqVersion] = useState(0); // bump khi requirement đổi -> Requirements reload
  const [schedVersion, setSchedVersion] = useState(0); // bump khi lịch đổi
  const [models, setModels] = useState([]);
  const [defaults, setDefaults] = useState({ model: "", economy: true, maxBudgetUsd: 0 });
  const [accountEvent, setAccountEvent] = useState(null);

  const loadProjects = useCallback(() => {
    fetch("/api/projects").then((r) => r.json()).then(setProjects);
  }, []);

  // Remove a project from the app. Files on disk are untouched.
  const deleteProject = async (p, e) => {
    e?.stopPropagation();
    if (!confirm(`Xoá project "${p.name}"?\n\nGỡ khỏi Agile Studio kèm requirement, log, tài liệu đã lưu, session và lịch của nó.\nKhông xoá file trên đĩa.`)) return;
    await fetch(`/api/projects/${p.id}`, { method: "DELETE" });
    setActive((cur) => (cur?.id === p.id ? null : cur));
    setSelectedId(null);
    loadProjects();
  };
  useEffect(loadProjects, [loadProjects]);

  // model active thật + cấu hình mặc định + session đang có
  useEffect(() => {
    fetch("/api/models").then((r) => r.json()).then((d) => setModels(d.models || [])).catch(() => {});
    fetch("/api/settings").then((r) => r.json())
      .then((s) => setDefaults({ model: s.model || "", economy: s.economy !== false, maxBudgetUsd: Number(s.maxBudgetUsd) || 0 }))
      .catch(() => {});
    fetch("/api/sessions").then((r) => r.json())
      .then((list) => setSessions(Object.fromEntries(list.map((s) => [s.id, normSession(s)])))).catch(() => {});
  }, []);

  const sessionsRef = useRef({});
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
  const featOf = (sid) => sessionsRef.current[sid]?.feature || "session";

  const upSession = (id, fn) => setSessions((prev) => (prev[id] ? { ...prev, [id]: fn(prev[id]) } : prev));
  const patchNode = (id, roleId, patch) =>
    upSession(id, (s) => ({ ...s, nodes: { ...s.nodes, [roleId]: { ...s.nodes[roleId], ...patch } } }));

  // WebSocket — định tuyến sự kiện theo session id
  useEffect(() => {
    const ws = new WebSocket(`ws://${location.host.replace("5311", "4311")}`);
    ws.onmessage = (m) => {
      const e = JSON.parse(m.data);
      const sid = e.session;
      switch (e.type) {
        case "session:init":
          setSessions((prev) => ({ ...prev, [sid]: normSession(e.data) })); break;
        case "session:removed":
          setSessions((prev) => { const n = { ...prev }; delete n[sid]; return n; }); break;
        case "node:start":
          patchNode(sid, e.id, { status: "running", account: e.account, activity: "…" }); break;
        case "node:activity":
          patchNode(sid, e.id, { activity: e.text }); break;
        case "node:done":
          patchNode(sid, e.id, { status: "done", activity: "✓ hoàn tất" }); break;
        case "node:error":
          upSession(sid, (s) => ({
            ...s, nodes: { ...s.nodes, [e.id]: { ...s.nodes[e.id], status: "error", activity: "✖ " + e.message } },
            error: { kind: e.errorKind || "unknown", message: e.message, roleId: e.id },
          })); break;
        case "node:skipped":
          patchNode(sid, e.id, { status: "disabled", activity: "⏭️ bỏ qua" }); break;
        case "node:stopped":
          patchNode(sid, e.id, { status: "pending", activity: "⏸ đã dừng" }); break;
        case "log":
          upSession(sid, (s) => ({ ...s, logs: [...s.logs, {
            t: new Date().toISOString(), role: e.role, roleName: e.roleName, emoji: e.emoji, kind: e.kind, text: e.text,
          }].slice(-500) })); break;
        case "flow:stopping": upSession(sid, (s) => ({ ...s, stopping: true })); break;
        case "flow:stopped": upSession(sid, (s) => ({ ...s, status: "stopped", stopping: false })); break;
        case "flow:done":
          upSession(sid, (s) => ({ ...s, status: "done", stopping: false }));
          desktopNotify("✅ Hoàn tất", featOf(sid)); break;
        case "flow:error":
          upSession(sid, (s) => ({ ...s, status: "error", stopping: false, error: s.error || { kind: "unknown", message: e.message } }));
          desktopNotify("✖ Lỗi session", featOf(sid) + " — " + (e.message || "")); break;
        case "account:switched":
          if (sid) upSession(sid, (s) => ({ ...s, activeAccount: e.to }));
          setAccountEvent({ kind: "switched", ...e }); setTimeout(() => setAccountEvent(null), 6000); break;
        case "account:exhausted":
          setAccountEvent({ kind: "exhausted", ...e });
          desktopNotify("⚠ Hết quota", "Các account gần cạn quota"); break;
        case "requirement:updated":
          setReqVersion((v) => v + 1); break;
        case "accounts:changed":
          setAccountEvent({ kind: "changed" }); setTimeout(() => setAccountEvent(null), 200); break;
        case "schedules:changed": case "schedule:fired":
          setSchedVersion((v) => v + 1); break;
      }
    };
    return () => ws.close();
  }, []);

  const projectSessions = active
    ? Object.values(sessions).filter((s) => s.projectId === active.id).sort((a, b) => b.startedAt - a.startedAt)
    : [];
  const selected = sessions[selectedId] && sessions[selectedId].projectId === active?.id ? sessions[selectedId] : null;

  // tự chọn session mới nhất của project khi đổi project / khi selected không còn hợp lệ
  useEffect(() => {
    if (!selected && projectSessions.length) setSelectedId(projectSessions[0].id);
  }, [active, projectSessions.length]); // eslint-disable-line

  const openRun = (prefill = null) => { setModalPrefill(prefill); setModalOpen(true); };
  const submitRun = (payload) => {
    if (!active) return;
    fetch(`/api/projects/${active.id}/run`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    }).then((r) => r.json()).then((j) => { if (j.session) setSelectedId(j.session.id); });
    setModalOpen(false); setTab("flow"); // xem session vừa tạo
  };
  const stopSession = (id) => fetch(`/api/sessions/${id}/stop`, { method: "POST" });
  const resumeSession = (id) => fetch(`/api/sessions/${id}/resume`, { method: "POST" });
  const toggleSaveLog = (id, saveLog) => fetch(`/api/sessions/${id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ saveLog }),
  });
  const toggleStreamLog = (id, streamLog) => fetch(`/api/sessions/${id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ streamLog }),
  });
  const loadSessionLogs = (id) => fetch(`/api/sessions/${id}/logs`).then((r) => r.json())
    .then((list) => upSession(id, (s) => ({ ...s, logs: list || [] })));
  const queueMessage = (id, payload) => fetch(`/api/sessions/${id}/queue`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  }).then((r) => r.json());
  const cancelQueue = (id, qid) => fetch(`/api/sessions/${id}/queue/${qid}`, { method: "DELETE" });
  const deleteSession = (id) => {
    if (!confirm("Xoá session này?")) return;
    if (id === selectedId) setSelectedId(null);
    fetch(`/api/sessions/${id}`, { method: "DELETE" });
  };
  const runningCount = projectSessions.filter((s) => s.status === "running").length;


  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">Agile&nbsp;Studio</div>
        <button className="add-proj" onClick={() => setAddProjOpen(true)}>+ Project</button>
        <div className="proj-list">
          {projects.map((p) => (
            <div key={p.id} className="proj-row">
              <button className={"proj" + (active?.id === p.id ? " on" : "")}
                onClick={() => { setActive(p); setSelectedId(null); }}>
                <span className="proj-name">{p.name}</span>
                <span className="proj-path">{p.repo_path}</span>
              </button>
              <button className="proj-del" title="Xoá project" onClick={(e) => deleteProject(p, e)}>🗑</button>
            </div>
          ))}
          {!projects.length && <p className="empty">Chưa có project. Bấm + Project để thêm.</p>}
        </div>
        <AccountBadge event={accountEvent} />
      </aside>

      <main className="main">
        {!active ? (
          <div className="placeholder">Chọn hoặc tạo một project để bắt đầu.</div>
        ) : (
          <>
            <header className="topbar">
              <div className="tabs">
                <button className={tab === "flow" ? "on" : ""} onClick={() => setTab("flow")}>Sessions</button>
                <button className={tab === "req" ? "on" : ""} onClick={() => setTab("req")}>Requirement</button>
                <button className={tab === "docs" ? "on" : ""} onClick={() => setTab("docs")}>Tài liệu</button>
                <button className={tab === "sched" ? "on" : ""} onClick={() => setTab("sched")}>⏰ Lịch</button>
              </div>
              {tab === "flow" && (
                <>
                  <button className="new-run" onClick={() => openRun()}>＋ Chạy feature</button>
                  {runningCount > 0 && <span className="running-badge">▶ {runningCount} đang chạy</span>}
                </>
              )}
              <button className="gear" title="Cài đặt" onClick={() => setSettingsOpen(true)}>⚙</button>
              <div className="proj-title">{active.name}</div>
            </header>

            {tab === "flow" ? (
              <div className="sessions-view">
                <div className="session-grid">
                  {projectSessions.map((s) => (
                    <SessionCard key={s.id} session={s} selected={s.id === selectedId}
                      onSelect={setSelectedId} onStop={stopSession} onResume={resumeSession} onDelete={deleteSession} />
                  ))}
                  {!projectSessions.length &&
                    <p className="empty">Chưa có session nào. Bấm <b>＋ Chạy feature</b> để bắt đầu (chạy nhiều feature song song được).</p>}
                </div>

                {selected && <SessionDetail session={selected} onStop={stopSession} onResume={resumeSession}
                  onToggleSaveLog={toggleSaveLog} onToggleStreamLog={toggleStreamLog} onLoadLogs={loadSessionLogs}
                  onQueue={queueMessage} onCancelQueue={cancelQueue} />}
              </div>
            ) : tab === "req" ? (
              <Requirements projectId={active.id} version={reqVersion}
                onAnalyze={(prefill) => openRun(prefill)} />
            ) : tab === "sched" ? (
              <ScheduleTab projects={projects} defaultProjectId={active.id} models={models} version={schedVersion} />
            ) : (
              <DocsPanel projectId={active.id} />
            )}
          </>
        )}
      </main>

      <RunModal open={modalOpen} onClose={() => setModalOpen(false)}
        onSubmit={submitRun} models={models} defaults={defaults} prefill={modalPrefill} />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)}
        models={models} defaults={defaults} onSaved={setDefaults} />
      <AddProjectModal open={addProjOpen} onClose={() => setAddProjOpen(false)} onCreated={loadProjects} />
    </div>
  );
}

const ERR_HINT = {
  login: "Cần đăng nhập: chạy `claude /login` cho account rồi bấm Tiếp tục.",
  quota: "Hết quota/token hoặc chạm trần $/node: đợi reset, hoặc thêm/đổi account, rồi Tiếp tục.",
  interrupted: "Server khởi động lại khi đang chạy. Bấm Tiếp tục để chạy nốt.",
  unknown: "Đã xảy ra lỗi. Xem log rồi bấm Tiếp tục để chạy lại từ node lỗi.",
};

// Ô nhập "hàng đợi" — gửi yêu cầu bổ sung cho session (đang chạy / xong / tạm dừng).
function QueueComposer({ session, onQueue, onCancelQueue }) {
  const [text, setText] = useState("");
  const [roles, setRoles] = useState([]);
  const toggle = (r) => setRoles((s) => (s.includes(r) ? s.filter((x) => x !== r) : [...s, r]));
  const send = () => {
    if (!text.trim() && !roles.length) return;
    onQueue(session.id, { text: text.trim(), roles });
    setText(""); setRoles([]);
  };
  const pending = (session.queue || []).filter((q) => !q.applied);
  return (
    <div className="queue">
      <div className="queue-title">➕ Yêu cầu bổ sung (queue) — nối tiếp hội thoại như Claude Code</div>
      <textarea className="queue-text" rows={2} value={text} onChange={(e) => setText(e.target.value)}
        placeholder="vd: làm thêm phần export PDF; hoặc bổ sung validate…" />
      <div className="queue-row">
        <div className="queue-chips">
          {ROLE_ORDER.map((r) => (
            <button key={r} className={"qchip" + (roles.includes(r) ? " on" : "")} onClick={() => toggle(r)}
              title={ROLE_META[r].name}>{ROLE_META[r].emoji} {ROLE_META[r].name}</button>
          ))}
        </div>
        <button className="queue-send" disabled={!text.trim() && !roles.length} onClick={send}>Gửi</button>
      </div>
      <div className="queue-hint">
        Chọn node để (re)chạy cho yêu cầu này (vd thêm 🔍QC). Không chọn → nối tiếp agent gần nhất (giữ ngữ cảnh).
      </div>
      {pending.length > 0 && (
        <div className="queue-list">
          <div className="queue-list-title">⏳ Chờ xử lý ({pending.length}) — có thể huỷ khi claude chưa chạy</div>
          {pending.map((q) => (
            <div className="qitem" key={q.id}>
              <span className="qitem-text">{q.roles?.length ? `[${q.roles.join(",")}] ` : ""}{q.text || "(chạy lại)"}</span>
              <button className="qitem-x" title="Huỷ message này" onClick={() => onCancelQueue(session.id, q.id)}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Chi tiết 1 session: canvas quy trình + log riêng của session đó.
function SessionDetail({ session, onStop, onResume, onToggleSaveLog, onToggleStreamLog, onLoadLogs, onQueue, onCancelQueue }) {
  const preset = presetOf(session.roles);
  const err = session.error;
  const resumable = session.status === "stopped" || session.status === "error"; // suy từ status (không dựa field cũ)
  // Nạp log đã lưu khi mở session mà log in-memory rỗng (vd sau khi tải lại trang).
  useEffect(() => {
    if (session.saveLog && (!session.logs || !session.logs.length)) onLoadLogs(session.id);
  }, [session.id, session.saveLog]); // eslint-disable-line
  return (
    <div className="sdetail">
      <div className="sdetail-head">
        <div className="sdetail-title">
          <b>{session.feature || "(không mô tả)"}</b>
          <span className="tag mode">{preset ? preset.icon + " " + preset.label : "Tuỳ chỉnh"}</span>
          <span className="tag">🧠 {session.model || "mặc định"}</span>
          {session.liveMode && <span className="tag" style={{ color: "var(--error)", borderColor: "var(--error)" }}>🔴 trực tiếp</span>}
          {session.cost > 0 && <span className="tag">💰 ${session.cost.toFixed(2)}</span>}
          <span className={"tag st-" + session.status}>{session.status}</span>
        </div>
        <div className="sdetail-actions">
          <button className={"savelog-toggle" + (session.saveLog ? " on" : "")}
            onClick={() => onToggleSaveLog(session.id, !session.saveLog)}
            title={session.saveLog ? "Đang lưu log — bấm để tắt" : "Bật lưu log session (xem lại sau)"}>
            💾 {session.saveLog ? "Đang lưu log" : "Lưu log"}
          </button>
          <button className={"savelog-toggle" + (session.streamLog ? " on" : "")}
            onClick={() => onToggleStreamLog(session.id, !session.streamLog)}
            title="Gửi log realtime vào thread Discord riêng của session này">
            📡 {session.streamLog ? "Đang stream" : "Stream Discord"}
          </button>
          {session.status === "running" &&
            <button className="stop" disabled={session.stopping} onClick={() => onStop(session.id)}>
              {session.stopping ? "Đang dừng…" : "⏸ Tạm dừng"}
            </button>}
          {resumable &&
            <button className="resume" onClick={() => onResume(session.id)}>▶ Tiếp tục</button>}
        </div>
      </div>
      {err && (
        <div className={"sdetail-err kind-" + (err.kind || "unknown")}>
          <b>{err.kind === "login" ? "🔑 Chưa đăng nhập" : err.kind === "quota" ? "⛽ Hết quota/token" : err.kind === "interrupted" ? "🔌 Bị ngắt" : "✖ Lỗi"}</b>
          <span>{ERR_HINT[err.kind] || ERR_HINT.unknown}</span>
          {err.message && <code>{err.message.slice(0, 240)}</code>}
        </div>
      )}
      <Canvas nodes={session.nodes} order={ROLE_ORDER} />
      <QueueComposer session={session} onQueue={onQueue} onCancelQueue={onCancelQueue} />
      <SessionLog logs={session.logs} />
    </div>
  );
}

// Log của RIÊNG session — tự cuộn xuống dòng mới nhất.
function SessionLog({ logs }) {
  const boxRef = useRef(null);
  useEffect(() => { const el = boxRef.current; if (el) el.scrollTop = el.scrollHeight; }, [logs.length]);
  return (
    <div className="logpanel">
      <div className="logpanel-head"><span>📜 Log session ({logs.length})</span></div>
      <div className="logpanel-body" ref={boxRef}>
        {!logs.length && <p className="muted">Chưa có hoạt động.</p>}
        {logs.map((l, i) => (
          <div className={"logline k-" + (l.kind || "")} key={i}>
            <span className="log-time">{new Date(l.t).toLocaleTimeString()}</span>
            <span className="log-role">{l.emoji} {l.roleName}</span>
            <span className="log-text">{l.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
