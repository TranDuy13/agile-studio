import React, { useEffect, useRef } from "react";

// Shared modal for the docgen screens. Replaces window.prompt/confirm: those cannot be styled,
// cannot show context (which document? which position?), and look nothing like the app.
// Esc closes, the backdrop closes, focus lands on the first field, Enter submits.

export default function Dialog({ open, title, sub, children, footer, onClose, width = 460 }) {
  const box = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    const first = box.current?.querySelector("input,select,textarea,button");
    first?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="dg-dlgbg" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="dg-dlg" ref={box} style={{ width: `min(${width}px, 94vw)` }} role="dialog" aria-modal="true">
        <div className="dg-dlg-h">
          <h4>{title}</h4>
          <button className="dg-dlg-x" onClick={onClose} title="Đóng (Esc)">✕</button>
        </div>
        {sub && <p>{sub}</p>}
        <div className="dg-dlg-body">{children}</div>
        <div className="dg-dlg-f">{footer}</div>
      </div>
    </div>
  );
}

// Bỏ `onOk` để có hộp thoại chỉ-đọc: khi không có gì để lưu thì một nút "Đóng" đúng hơn là một nút
// "Đồng ý" chẳng làm gì.
export function DialogButtons({ onCancel, onOk, okLabel = "Đồng ý", cancelLabel = "Huỷ", okDisabled, danger }) {
  return (
    <>
      <button className="ghost" onClick={onCancel}>{cancelLabel}</button>
      {onOk && (
        <button className={danger ? "primary danger" : "primary"} disabled={okDisabled} onClick={onOk}>{okLabel}</button>
      )}
    </>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="dg-field">
      <span className="dg-label">{label}</span>
      {children}
      {hint && <span className="dg-dlg-hint">{hint}</span>}
    </label>
  );
}
