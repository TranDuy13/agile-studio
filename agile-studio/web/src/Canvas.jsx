import React, { useState } from "react";

// Canvas luồng cố định kiểu n8n: node xếp ngang, nối bằng đường, node đang chạy
// hiện activity cụ thể; click node mở panel xem toàn bộ log việc đã làm.
export default function Canvas({ nodes, order, disabled = [], onToggle, locked = false }) {
  const [open, setOpen] = useState(null);
  const n = (id) => nodes[id] || { status: "pending", activity: "", log: [] };
  const isOff = (id) => disabled.includes(id);

  return (
    <div className="canvas">
      <div className="flow">
        {order.map((id, i) => {
          const node = n(id);
          const off = isOff(id);
          return (
            <React.Fragment key={id}>
              <div className={`node ${off ? "disabled" : (node.status || "pending")}`}>
                <button className="node-body" onClick={() => setOpen(id)}>
                  <div className="node-head">
                    <span className="node-emoji">{node.emoji}</span>
                    <span className="node-status-dot" />
                  </div>
                  <div className="node-name">{node.name || id}</div>
                  <div className="node-id">{id}</div>
                  <div className="node-activity">
                    {off ? "⏻ đã tắt" :
                     node.status === "running" ? (node.activity || "…") :
                     node.status === "done" ? "✓ xong" :
                     node.status === "error" ? "✖ lỗi" : "chờ"}
                  </div>
                  {node.account && node.status === "running" &&
                    <div className="node-acct">acct: {node.account}</div>}
                </button>
                {onToggle && (
                  <button className={"node-toggle" + (off ? " off" : "")}
                    disabled={locked}
                    title={off ? "Bật lại node này" : "Tắt node này (bỏ qua khi chạy)"}
                    onClick={() => onToggle(id)}>
                    {off ? "Bật" : "Tắt"}
                  </button>
                )}
              </div>
              {i < order.length - 1 && (
                <div className={"link" + (n(id).status === "done" ? " done" : "")}>
                  <svg width="46" height="24"><line x1="2" y1="12" x2="44" y2="12"
                    stroke="currentColor" strokeWidth="2" markerEnd="url(#arrow)" />
                    <defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3"
                      orient="auto"><path d="M0,0 L6,3 L0,6" fill="currentColor" /></marker></defs>
                  </svg>
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {open && (
        <div className="detail" onClick={() => setOpen(null)}>
          <div className="detail-card" onClick={(e) => e.stopPropagation()}>
            <div className="detail-head">
              <span>{n(open).emoji} {n(open).name}</span>
              <button onClick={() => setOpen(null)}>✕</button>
            </div>
            <div className="detail-status">Trạng thái: <b>{n(open).status}</b></div>
            <div className="detail-log">
              {(n(open).log || []).length === 0 && <p className="muted">Chưa có hoạt động.</p>}
              {(n(open).log || []).map((l, i) => <div className="log-line" key={i}>{l}</div>)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
