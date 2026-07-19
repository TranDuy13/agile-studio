import React, { useEffect, useState } from "react";
import { acctName } from "./AccountBadge.jsx";

const barColor = (p) => (p >= 90 ? "#e24b4a" : p >= 70 ? "#ef9f27" : "#1d9e75");
function fmtReset(iso) {
  if (!iso) return "—";
  const t = new Date(iso), now = Date.now();
  const ms = t - now;
  if (ms <= 0) return "đã reset";
  const h = Math.floor(ms / 3.6e6), m = Math.floor((ms % 3.6e6) / 6e4);
  const rel = h >= 24 ? `còn ${Math.floor(h / 24)}n ${h % 24}h` : h > 0 ? `còn ${h}h ${m}p` : `còn ${m}p`;
  return `${t.toLocaleString()} (${rel})`;
}
function Bar({ label, pct, reset }) {
  return (
    <div className="usage-row">
      <div className="usage-row-top"><span>{label}</span><b>{pct != null ? Math.round(pct) + "%" : "—"}</b></div>
      <div className="usage-bar"><div className="usage-fill" style={{ width: (pct || 0) + "%", background: barColor(pct || 0) }} /></div>
      {reset !== undefined && <div className="usage-reset">reset: {fmtReset(reset)}</div>}
    </div>
  );
}

// Xem usage chi tiết 1 account (giống tab Usage của Claude): cửa sổ 5h, 7 ngày, theo model, các limit.
export default function UsageModal({ open, account, onClose }) {
  const [u, setU] = useState(null);
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !account) return;
    setLoading(true); setU(null); setInfo(null);
    fetch(`/api/accounts/${account.id}/usage`).then((r) => r.json())
      .then((d) => { setU(d.usage); setInfo({ profile: d.profile, configDir: d.configDir }); })
      .finally(() => setLoading(false));
  }, [open, account]);

  if (!open || !account) return null;
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><span>📊 Usage · {acctName(account)}</span><button onClick={onClose}>✕</button></div>

        {info && (
          <div className="acct-info">
            {info.profile ? (
              <>
                <div className="acct-info-row"><span>Tài khoản</span><b>{info.profile.name || "—"}</b></div>
                <div className="acct-info-row"><span>Email</span><b>{info.profile.email || "—"}</b></div>
                <div className="acct-info-row"><span>Gói</span><b className={"plan plan-" + info.profile.plan}>{(info.profile.plan || "").toUpperCase()}</b></div>
                {info.profile.org && <div className="acct-info-row"><span>Tổ chức</span><b>{info.profile.org}</b></div>}
              </>
            ) : <div className="acct-info-row"><span>Tài khoản thật</span><b>không đọc được (login lại?)</b></div>}
            <div className="acct-info-row dim"><span>Config dir</span><code>{info.configDir}</code></div>
          </div>
        )}

        {loading && <p className="muted">Đang tải usage…</p>}
        {!loading && !u && <p className="muted">Không đọc được usage (chưa đăng nhập hoặc lỗi mạng).</p>}
        {u && (
          <div className="usage">
            <Bar label="Cửa sổ 5 giờ" pct={u.fiveHourPct} reset={u.resetsAt} />
            <Bar label="7 ngày (tổng)" pct={u.sevenDayPct} reset={u.sevenDayResetsAt} />
            {u.opusPct != null && <Bar label="7 ngày · Opus" pct={u.opusPct} />}
            {u.sonnetPct != null && <Bar label="7 ngày · Sonnet" pct={u.sonnetPct} />}
            {u.fablePct != null && <Bar label="7 ngày · Fable" pct={u.fablePct} />}

            {Array.isArray(u.limits) && u.limits.length > 0 && (
              <div className="usage-limits">
                <div className="usage-limits-title">Chi tiết giới hạn</div>
                {u.limits.map((l, i) => (
                  <div className="usage-limit" key={i}>
                    <span className={"usage-sev sev-" + (l.severity || "normal")}>{l.severity || "normal"}</span>
                    <span className="usage-kind">{l.kind}{l.active ? " (đang áp dụng)" : ""}</span>
                    <span className="usage-lpct">{l.percent != null ? Math.round(l.percent) + "%" : "—"}</span>
                    <span className="usage-lreset">{l.resetsAt ? fmtReset(l.resetsAt) : ""}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
