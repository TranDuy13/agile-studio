import React, { useEffect, useState, useCallback } from "react";
import AccountLogin from "./AccountLogin.jsx";
import UsageModal from "./UsageModal.jsx";

// Hiện account đang dùng + % quota; poll định kỳ; báo khi auto-switch; thêm/xoá account.
export default function AccountBadge({ event }) {
  const [data, setData] = useState({ active: null, accounts: [] });
  const [adding, setAdding] = useState(false);
  const [viewing, setViewing] = useState(null); // account đang xem usage chi tiết
  const [busy, setBusy] = useState(null); // id đang refresh, hoặc "all"
  // Chỉ nạp DANH SÁCH account (không gọi API usage). Giữ lại % usage đã fetch trước đó.
  const load = useCallback(() => {
    fetch("/api/accounts").then((r) => r.json()).then((d) =>
      setData((prev) => ({ ...d, accounts: d.accounts.map((a) => ({
        ...a, usage: a.usage ?? prev.accounts.find((p) => p.id === a.id)?.usage ?? null,
      })) }))).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]); // nạp 1 lần, KHÔNG tự poll định kỳ
  useEffect(() => { if (event) load(); }, [event, load]);

  const remove = async (id) => {
    if (!confirm("Xoá account này khỏi danh sách? (không xoá đăng nhập gốc)")) return;
    await fetch(`/api/accounts/${id}`, { method: "DELETE" }); load();
  };
  const toggleEnabled = async (id, enabled) => {
    await fetch(`/api/accounts/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }),
    }); load();
  };
  const setPreferred = async (id) => {
    const next = data.preferred === id ? "" : id; // bấm lại để bỏ mặc định
    await fetch("/api/settings", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preferredAccount: next }),
    }); load();
  };
  // Bấm refresh tất cả -> lúc này MỚI gọi API usage cho mọi account.
  const refreshAll = async () => {
    setBusy("all");
    try { const d = await fetch("/api/accounts?usage=1").then((r) => r.json()); setData(d); }
    finally { setBusy(null); }
  };
  const refreshOne = async (id) => {
    setBusy(id);
    try {
      const r = await fetch(`/api/accounts/${id}/usage`).then((x) => x.json());
      setData((d) => ({ ...d, accounts: d.accounts.map((a) => (a.id === id ? { ...a, usage: r.usage } : a)) }));
    } finally { setBusy(null); }
  };

  return (
    <div className="accounts">
      <div className="acct-title">
        <span>Tài khoản Claude</span>
        <div className="acct-title-btns">
          <button className={"acct-icon" + (busy === "all" ? " spin" : "")} onClick={refreshAll}
            disabled={busy != null} title="Làm mới % usage tất cả">↻</button>
          <button className="acct-icon" onClick={() => setAdding(true)} title="Thêm account (đăng nhập)">+</button>
        </div>
      </div>
      {data.accounts.map((a) => {
        const pct = a.usage?.fiveHourPct;
        const on = a.id === data.active;
        return (
          <div key={a.id} className={"acct" + (on ? " on" : "") + (a.disabled ? " off" : "")}>
            <div className="acct-row">
              <span className="acct-dot" data-on={on} />
              <button className="acct-label" onClick={() => setViewing(a)} title="Xem usage chi tiết">{a.label}</button>
              {a.disabled ? <span className="acct-off-tag">đã tắt</span> : on && <span className="acct-active">đang dùng</span>}
              <div className="acct-acts">
                {!a.disabled && (
                  <button className={"acct-btn star" + (data.preferred === a.id ? " on" : "")}
                    onClick={() => setPreferred(a.id)}
                    title={data.preferred === a.id ? "Đang là account mặc định (bấm để bỏ)" : "Đặt làm account mặc định cho session mới"}>
                    {data.preferred === a.id ? "★" : "☆"}</button>
                )}
                <button className="acct-btn power" onClick={() => toggleEnabled(a.id, a.disabled)}
                  title={a.disabled ? "Bật dùng lại" : "Tắt (không dùng account này)"}>{a.disabled ? "▶" : "⏻"}</button>
                <button className={"acct-btn refresh" + (busy === a.id ? " spin" : "")} disabled={busy != null}
                  onClick={() => refreshOne(a.id)} title="Làm mới % usage">↻</button>
                <button className="acct-btn del" onClick={() => remove(a.id)} title="Xoá">✕</button>
              </div>
            </div>
            <div className="acct-bar">
              <div className="acct-fill" style={{
                width: pct != null ? `${Math.round(pct)}%` : "0%",
                background: pct >= 90 ? "#e24b4a" : pct >= 70 ? "#ef9f27" : "#1d9e75",
              }} />
            </div>
            <div className="acct-pct">{pct != null ? `${Math.round(pct)}% (5h)` : "—"}</div>
          </div>
        );
      })}
      {event?.kind === "switched" && (
        <div className="acct-toast">↻ Tự đổi sang {event.label}</div>
      )}
      {event?.kind === "exhausted" && (
        <div className="acct-toast warn">⚠ Các account gần cạn quota</div>
      )}
      <AccountLogin open={adding} onClose={() => setAdding(false)} onDone={load} />
      <UsageModal open={!!viewing} account={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}
