import React from "react";
import { ROLE_ORDER, presetOf } from "./presets.js";

const STATUS_LABEL = { running: "Đang chạy", done: "Hoàn tất", stopped: "Đã dừng", error: "Lỗi" };

// Card tóm tắt 1 session: feature, mode, model, node đang làm, tiến độ. Click để xem chi tiết.
// session.nodes là MAP { roleId -> {status, activity, emoji, name, account} }.
const ERR_SHORT = { login: "🔑 cần /login", quota: "⛽ hết quota/token", interrupted: "🔌 bị ngắt", unknown: "✖ lỗi" };

export default function SessionCard({ session, selected, onSelect, onStop, onResume, onDelete }) {
  const nodes = session.nodes || {};
  const n = (id) => nodes[id] || { id, status: "pending" };
  const inMode = session.roles;
  const done = inMode.filter((id) => n(id).status === "done").length;
  const running = ROLE_ORDER.map(n).find((x) => x.status === "running");
  const errored = ROLE_ORDER.map(n).find((x) => x.status === "error");
  const preset = presetOf(session.roles);
  const pct = inMode.length ? Math.round((done / inMode.length) * 100) : 0;

  return (
    <div className={"scard st-" + session.status + (selected ? " sel" : "")} onClick={() => onSelect(session.id)}>
      <div className="scard-top">
        <span className={"scard-badge st-" + session.status}>{STATUS_LABEL[session.status] || session.status}</span>
        {session.status === "running" &&
          <button className="scard-stop" onClick={(e) => { e.stopPropagation(); onStop(session.id); }}>⏸ Dừng</button>}
        {session.resumable &&
          <button className="scard-resume" onClick={(e) => { e.stopPropagation(); onResume(session.id); }}>▶ Tiếp tục</button>}
        {session.status !== "running" &&
          <button className="scard-del" title="Xoá session" onClick={(e) => { e.stopPropagation(); onDelete(session.id); }}>🗑</button>}
      </div>

      <div className="scard-feature" title={session.feature}>{session.feature || "(không mô tả)"}</div>

      <div className="scard-meta">
        <span className="tag mode">{preset ? preset.icon + " " + preset.label : "Tuỳ chỉnh"}</span>
        <span className="tag">🧠 {session.model || "mặc định"}</span>
        {session.activeAccount && <span className="tag">👤 {session.activeAccount}</span>}
      </div>

      <div className="scard-flow">
        {ROLE_ORDER.map((rid) => {
          const nd = n(rid);
          const isIn = session.roles.includes(rid);
          return <span key={rid} className={"fdot " + (isIn ? nd.status : "off")} title={`${nd.name || rid}: ${nd.status}`}>
            {nd.emoji || "•"}
          </span>;
        })}
      </div>

      <div className="scard-now">
        {session.error ? (ERR_SHORT[session.error.kind] || ERR_SHORT.unknown) + (errored ? ` @ ${errored.name}` : "") :
         running ? `${running.emoji} ${running.name}: ${running.activity || "…"}` :
         session.status === "done" ? "✓ đã xong toàn bộ" :
         session.status === "stopped" ? "⏸ đã dừng — Tiếp tục để chạy nốt" : "…"}
      </div>

      <div className="scard-bar"><div className="scard-fill" style={{ width: pct + "%" }} /></div>
    </div>
  );
}
