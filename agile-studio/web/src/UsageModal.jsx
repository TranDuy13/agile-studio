import React, { useCallback, useEffect, useState } from "react";
import { acctName } from "./AccountBadge.jsx";

const barColor = (p) => (p >= 90 ? "#e24b4a" : p >= 70 ? "#ef9f27" : "#1d9e75");
const AUTH_LABEL = {
  claudeai: "Claude AI (đăng nhập)", apikey: "API key (ANTHROPIC_API_KEY)",
  "apikey-helper": "API key (apiKeyHelper)",
};

function fmtReset(iso) {
  if (!iso) return "—";
  const t = new Date(iso), now = Date.now();
  const ms = t - now;
  if (ms <= 0) return "đã reset";
  const h = Math.floor(ms / 3.6e6), m = Math.floor((ms % 3.6e6) / 6e4);
  const rel = h >= 24 ? `còn ${Math.floor(h / 24)}n ${h % 24}h` : h > 0 ? `còn ${h}h ${m}p` : `còn ${m}p`;
  return `${t.toLocaleString()} (${rel})`;
}
// Dòng ngắn kiểu tab Usage của Claude ("Resets in 2h").
function fmtResetShort(iso) {
  if (!iso) return null;
  const ms = new Date(iso) - Date.now();
  if (ms <= 0) return "đã reset";
  const h = Math.floor(ms / 3.6e6), m = Math.floor((ms % 3.6e6) / 6e4);
  return "reset sau " + (h >= 24 ? `${Math.round(h / 24)} ngày` : h > 0 ? `${h}h` : `${m} phút`);
}
const fmtTokens = (n) => (!n ? "0" : n >= 1e9 ? (n / 1e9).toFixed(1) + "B"
  : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(n));

function Bar({ label, pct, reset, short }) {
  return (
    <div className="usage-row">
      <div className="usage-row-top"><span>{label}</span><b>{pct != null ? Math.round(pct) + "%" : "—"}</b></div>
      <div className="usage-bar"><div className="usage-fill" style={{ width: (pct || 0) + "%", background: barColor(pct || 0) }} /></div>
      {reset !== undefined && <div className="usage-reset">{short ? fmtResetShort(reset) || "—" : "reset: " + fmtReset(reset)}</div>}
    </div>
  );
}

// Bảng phân bổ cục bộ: mỗi dòng = 1 model / 1 project, thanh = tỉ lệ token so với dòng cao nhất.
function AttrRows({ rows, total }) {
  if (!rows?.length) return <div className="attr-empty">Chưa có dữ liệu — sẽ tích luỹ khi bạn chạy session.</div>;
  const max = Math.max(...rows.map((r) => r.tokens), 1);
  return (
    <div className="attr-rows">
      {rows.map((r) => (
        <div className="attr-row" key={r.key}>
          <div className="attr-top">
            <span className="attr-key" title={r.key}>{r.key}</span>
            <span className="attr-val">{fmtTokens(r.tokens)} tok
              {total > 0 ? ` · ${Math.round((r.tokens / total) * 100)}%` : ""}</span>
          </div>
          <div className="usage-bar"><div className="usage-fill attr-fill" style={{ width: (r.tokens / max) * 100 + "%" }} /></div>
          <div className="attr-sub">{r.sessions} công việc{r.fivePct > 0 ? ` · ≈${r.fivePct.toFixed(1)}% cửa sổ 5h` : ""}{r.cost > 0 ? ` · $${r.cost.toFixed(2)}` : ""}</div>
        </div>
      ))}
    </div>
  );
}

// Xem usage chi tiết 1 account (giống tab Usage của Claude): tài khoản, cửa sổ 5h / 7 ngày,
// theo model, các limit, và phần "điều gì đang chiếm quota" tính từ session trên máy này.
export default function UsageModal({ open, account, onClose }) {
  const [u, setU] = useState(null);
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [win, setWin] = useState("day");   // day | week — như toggle Day/Week của Claude
  const [attr, setAttr] = useState(null);

  const loadUsage = useCallback(() => {
    if (!account) return;
    setLoading(true); setU(null); setInfo(null);
    fetch(`/api/accounts/${account.id}/usage`).then((r) => r.json())
      .then((d) => { setU(d.usage); setInfo({ profile: d.profile, configDir: d.configDir, authMethod: d.authMethod }); })
      .finally(() => setLoading(false));
  }, [account]);

  useEffect(() => { if (open && account) loadUsage(); }, [open, account, loadUsage]);
  useEffect(() => {
    if (!open || !account) return;
    setAttr(null);
    fetch(`/api/accounts/${account.id}/attribution?window=${win}`).then((r) => r.json()).then(setAttr).catch(() => {});
  }, [open, account, win]);

  if (!open || !account) return null;
  const attrTotal = attr?.totals?.tokens || 0;
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal usage-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>📊 Usage · {acctName(account)}</span>
          <span className="modal-head-btns">
            <button className={"acct-icon" + (loading ? " spin" : "")} title="Làm mới" onClick={loadUsage} disabled={loading}>↻</button>
            <button onClick={onClose}>✕</button>
          </span>
        </div>

        <div className="usage-sec-title">Tài khoản</div>
        {info && (
          <div className="acct-info">
            <div className="acct-info-row"><span>Phương thức đăng nhập</span>
              <b>{AUTH_LABEL[info.authMethod] || "chưa đăng nhập"}</b></div>
            {info.profile ? (
              <>
                <div className="acct-info-row"><span>Tài khoản</span><b>{info.profile.name || "—"}</b></div>
                <div className="acct-info-row"><span>Email</span><b>{info.profile.email || "—"}</b></div>
                <div className="acct-info-row"><span>Tổ chức</span><b>{info.profile.org || "—"}</b></div>
                <div className="acct-info-row"><span>Gói</span><b className={"plan plan-" + info.profile.plan}>{(info.profile.plan || "").toUpperCase()}</b></div>
              </>
            ) : <div className="acct-info-row"><span>Tài khoản thật</span><b>không đọc được (login lại?)</b></div>}
            <div className="acct-info-row dim"><span>Config dir</span><code>{info.configDir}</code></div>
          </div>
        )}

        <div className="usage-sec-title">Usage</div>
        {loading && <p className="muted">Đang tải usage…</p>}
        {!loading && !u && <p className="muted">Không đọc được usage (chưa đăng nhập hoặc lỗi mạng).</p>}
        {u && (
          <div className="usage">
            <Bar label="Phiên (5 giờ)" pct={u.fiveHourPct} reset={u.resetsAt} short />
            <Bar label="Tuần (7 ngày)" pct={u.sevenDayPct} reset={u.sevenDayResetsAt} short />
            {u.opusPct != null && <Bar label="7 ngày · Opus" pct={u.opusPct} />}
            {u.sonnetPct != null && <Bar label="7 ngày · Sonnet" pct={u.sonnetPct} />}
            {u.fablePct != null && <Bar label="7 ngày · Fable" pct={u.fablePct} />}

            <a className="usage-link" href="https://claude.ai/settings/usage" target="_blank" rel="noreferrer">
              Quản lý usage trên claude.ai ↗</a>

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

        <div className="usage-sec-title">Điều gì đang chiếm quota?</div>
        <div className="attr">
          <div className="attr-head">
            <div className="attr-toggle">
              <button className={win === "day" ? "on" : ""} onClick={() => setWin("day")}>24 giờ</button>
              <button className={win === "week" ? "on" : ""} onClick={() => setWin("week")}>7 ngày</button>
            </div>
            <span className="attr-total">
              {attr ? `${attr.totals.sessions} công việc · ${fmtTokens(attrTotal)} token` : "…"}
            </span>
          </div>
          <div className="attr-note">
            Ước lượng — tính từ session chạy trên máy này bằng account này; KHÔNG gồm máy khác,
            claude.ai hay các công cụ khác. Anthropic không trả về phân bổ theo model/project.
          </div>
          <div className="attr-block-title">Theo model</div>
          <AttrRows rows={attr?.byModel} total={attrTotal} />
          <div className="attr-block-title">Theo project</div>
          <AttrRows rows={attr?.byProject} total={attrTotal} />
        </div>
      </div>
    </div>
  );
}
