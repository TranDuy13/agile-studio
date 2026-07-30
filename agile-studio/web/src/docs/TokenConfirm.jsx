import React, { useState } from "react";

// Token warning convention (Q13): every button shows its estimate, but only work above the
// threshold opens this dialog. "Đừng hỏi lại" is remembered per kind of work, not globally.
export const WORK_LABELS = {
  survey: "Khảo sát & đề xuất dàn ý",
  revise: "Đề xuất lại dàn ý",
  write: "Viết nội dung cả bộ",
};

export function fmtTokens(n) {
  const v = Number(n) || 0;
  if (v >= 1000000) return (v / 1000000).toFixed(v >= 10000000 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (v >= 1000) return Math.round(v / 1000) + "K";
  return String(v);
}

export function shouldAsk(kind, tokens, settings) {
  if (!settings) return false;
  if (settings.dontAsk?.[kind]) return false;
  return Number(tokens) > Number(settings.tokenThreshold ?? 50000);
}

// The chip that sits inside a button. Below the threshold it is quiet; above it, it is loud —
// the colour alone tells you whether pressing will open a dialog.
export function TokenChip({ tokens, threshold = 50000, free = false }) {
  if (free) return <span className="tok free">miễn phí</span>;
  const hot = Number(tokens) > Number(threshold);
  return <span className={"tok" + (hot ? "" : " lo")}>⛽ ~{fmtTokens(tokens)}</span>;
}

export default function TokenConfirm({ open, kind, tokens, settings, account, usage, spent,
  onCancel, onConfirm, onSettings }) {
  const [dontAsk, setDontAsk] = useState(false);
  if (!open) return null;
  const per5h = Number(settings?.tokensPer5h) || 2000000;
  const pctOf5h = (Number(tokens) / per5h) * 100;
  const left = usage?.fiveHourPct != null ? Math.max(0, 100 - Math.round(usage.fiveHourPct)) : null;

  return (
    <div className="dg-dlgbg" onClick={onCancel}>
      <div className="dg-dlg" onClick={(e) => e.stopPropagation()}>
        <h4>Việc này sẽ tiêu token</h4>
        <p>
          {WORK_LABELS[kind] || "Việc này"} — ước tính <b className="hl">~{fmtTokens(tokens)} token</b>
          {" "}(≈ {pctOf5h.toFixed(pctOf5h < 10 ? 1 : 0)}% một cửa sổ 5h). Đây là <b className="hl">ước tính
          có sai số lớn</b>; con số thật cập nhật dần khi chạy.
        </p>
        <div className="dg-card" style={{ padding: "9px 11px" }}>
          <div className="dg-stat">
            <span>Account</span>
            <b>{account?.label || account?.id || "—"}{left != null ? ` · còn ${left}%` : ""}</b>
          </div>
          <div className="dg-stat"><span>Đã tiêu cho bộ này</span><b>{fmtTokens(spent || 0)} token</b></div>
        </div>
        <button className={"dg-chk" + (dontAsk ? " on" : "")} onClick={() => setDontAsk(!dontAsk)}>
          <i className="bx">{dontAsk ? "✓" : ""}</i>
          <span className="dg-chk-t">
            <b>Không hỏi lại cho loại việc này</b>
            <span>Chỉ áp cho “{WORK_LABELS[kind] || "việc này"}”, không tắt cảnh báo của việc khác.</span>
          </span>
        </button>
        {onSettings && <ThresholdField settings={settings} onChange={onSettings} />}
        <div className="dg-row" style={{ justifyContent: "flex-end" }}>
          <button className="ghost" onClick={onCancel}>Huỷ</button>
          <button className="primary" onClick={() => onConfirm(dontAsk)}>Chạy</button>
        </div>
      </div>
    </div>
  );
}

// The threshold is a studio-wide rule, not a docgen one: it applies to every action that spends
// tokens. It is editable right here because this dialog is where people realise it is wrong —
// too low and they are nagged, too high and money leaks. Cài đặt → Chung gets the same control
// when the settings modal is rebuilt (Q14/D3); both read /api/agent-settings.
export function ThresholdField({ settings, onChange }) {
  const v = Math.round((settings?.tokenThreshold ?? 50000) / 1000);
  return (
    <div className="dg-note" style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
      Ngưỡng hỏi <b style={{ color: "var(--ink)" }}>toàn cục</b>:
      <input className="dg-inp num" style={{ width: 66, padding: "3px 7px" }} type="number" min="0" step="5"
        value={v} onChange={(e) => onChange({ tokenThreshold: Math.max(0, Number(e.target.value) || 0) * 1000 })} />
      K token — áp cho mọi việc tốn token của Studio, không riêng tài liệu.
    </div>
  );
}
