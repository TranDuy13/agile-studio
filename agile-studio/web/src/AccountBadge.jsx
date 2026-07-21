import React, { useEffect, useState, useCallback, useRef } from "react";
import AccountLogin from "./AccountLogin.jsx";
import UsageModal from "./UsageModal.jsx";

// Tên hiển thị (issue 13): có nickname thật -> nickname; nếu không -> email; cuối cùng -> id.
// "Default" là label hệ thống (không phải người dùng đặt) nên coi như chưa đặt -> hiện email.
export const acctName = (a) =>
  (a.label && a.label.trim() && a.label !== "Default") ? a.label : (a.email || a.id);

// Chú thích icon cho popover ℹ (issue 15).
const LEGEND_ROWS = [
  ["▶", "đang dùng"],
  ["★ / ☆", "đặt / bỏ mặc định"],
  ["⏻ / ▶", "tắt / bật lại"],
  ["↻", "làm mới usage"],
  ["🔑", "đăng nhập lại"],
  ["✕", "xoá khỏi danh sách"],
];

// Icon info + popover chú thích (thay cho native title cho đẹp).
function IconLegend() {
  return (
    <div className="acct-legend" tabIndex={0} aria-label="Chú thích icon">
      <span className="info-i">i</span>
      <div className="acct-legend-pop" role="tooltip">
        <div className="legend-title">Chú thích icon</div>
        {LEGEND_ROWS.map(([k, v]) => (
          <div className="legend-row" key={k}><span>{k}</span>{v}</div>
        ))}
      </div>
    </div>
  );
}

// Hiện account + % quota; làm mới khi quay lại tab (issue 09); thêm/xoá account.
export default function AccountBadge({ event }) {
  const [data, setData] = useState({ active: null, accounts: [] });
  const [adding, setAdding] = useState(false);
  const [relogin, setRelogin] = useState(null); // account cần đăng nhập lại
  const [viewing, setViewing] = useState(null); // account đang xem usage chi tiết
  const [busy, setBusy] = useState(null); // id đang refresh, hoặc "all"
  const lastRefresh = useRef(0);           // debounce cho auto-refresh khi focus (issue 09)

  // Chỉ nạp DANH SÁCH account (không gọi API usage). Giữ lại % usage đã fetch trước đó.
  const load = useCallback(() => {
    return fetch("/api/accounts").then((r) => r.json()).then((d) =>
      setData((prev) => ({ ...d, accounts: d.accounts.map((a) => ({
        ...a, usage: a.usage ?? prev.accounts.find((p) => p.id === a.id)?.usage ?? null,
      })) }))).catch(() => {});
  }, []);
  useEffect(() => { if (event) load(); }, [event, load]);

  // Bấm refresh tất cả -> lúc này MỚI gọi API usage cho mọi account.
  const refreshAll = useCallback(async () => {
    setBusy("all"); lastRefresh.current = Date.now();
    try { const d = await fetch("/api/accounts?usage=1").then((r) => r.json()); setData(d); }
    finally { setBusy(null); }
  }, []);
  const refreshOne = useCallback(async (id) => {
    setBusy(id); lastRefresh.current = Date.now();
    try {
      const r = await fetch(`/api/accounts/${id}/usage`).then((x) => x.json());
      setData((d) => ({ ...d, accounts: d.accounts.map((a) => (a.id === id ? { ...a, usage: r.usage } : a)) }));
    } finally { setBusy(null); }
  }, []);

  // Vừa thêm / đăng nhập lại 1 account: nạp danh sách RỒI lấy usage của chính account đó,
  // nếu không nó sẽ nằm im ở "—" cho tới lần refresh thủ công kế tiếp.
  const afterLogin = useCallback(async (id) => {
    await load();
    if (id) await refreshOne(id); else await refreshAll();
  }, [load, refreshOne, refreshAll]);

  // F5/mount: kiểm tra usage NGAY khi tải trang (reload phải tự check limit).
  useEffect(() => { refreshAll(); }, [refreshAll]);

  // Issue 09: làm mới usage khi quay lại tab (focus/visible), có debounce ~30s. KHÔNG poll nền.
  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastRefresh.current < 30000) return;
      refreshAll();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refreshAll]);

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

  return (
    <div className="accounts">
      <div className="acct-title">
        <span>Tài khoản Claude</span>
        <div className="acct-title-btns">
          <IconLegend />
          <button className={"acct-icon" + (busy === "all" ? " spin" : "")} onClick={refreshAll}
            disabled={busy != null} title="Làm mới % usage tất cả">↻</button>
          <button className="acct-icon" onClick={() => setAdding(true)} title="Thêm account (đăng nhập)">+</button>
        </div>
      </div>
      <div className="acct-list thin-scroll">
      {data.accounts.map((a) => {
        const pct = a.usage?.fiveHourPct;
        const on = a.id === data.active;
        return (
          <div key={a.id} className={"acct" + (on ? " on" : "") + (a.disabled ? " off" : "")}>
            <div className="acct-row">
              <span className="acct-dot" data-on={on} />
              <button className="acct-label" onClick={() => setViewing(a)}
                title={"Xem usage chi tiết" + (a.email ? ` (${a.email})` : "")}>{acctName(a)}</button>
              {a.disabled ? <span className="acct-off-tag">đã tắt</span>
                : a.loggedIn === false ? <span className="acct-expired">hết hạn</span>
                : on && <span className="acct-active" title="đang dùng" aria-label="đang dùng">▶</span>}
              <div className="acct-acts">
                {!a.disabled && a.loggedIn === false && (
                  <button className="acct-btn relogin" title="Token hết hạn — đăng nhập lại" onClick={() => setRelogin(a)}>🔑</button>
                )}
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
      </div>
      {event?.kind === "switched" && (
        <div className="acct-toast">↻ Tự đổi sang {event.label}</div>
      )}
      {event?.kind === "exhausted" && (
        <div className="acct-toast warn">⚠ Các account gần cạn quota</div>
      )}
      <AccountLogin open={adding} onClose={() => setAdding(false)} onDone={afterLogin} />
      <AccountLogin open={!!relogin} relogin={relogin} onClose={() => setRelogin(null)} onDone={afterLogin} />
      <UsageModal open={!!viewing} account={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}
