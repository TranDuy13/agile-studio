import React, { useEffect, useState } from "react";

// Modal đăng nhập account: nhập label -> lấy URL -> mở & authorize -> dán code -> tự thêm.
// relogin (tuỳ chọn): account đang hết hạn -> đăng nhập lại vào đúng configDir cũ.
//
// The two server calls are slow (spawning the Claude CLI, then waiting for it to confirm the
// code — up to ~20s). `busy` is kept OUT of `step` so a pending call never rewinds the modal
// to the first screen: the current step stays on screen, disabled, under a visible spinner.
export default function AccountLogin({ open, onClose, onDone, relogin }) {
  const [step, setStep] = useState("label"); // label | code | done
  const [busy, setBusy] = useState("");      // "" | "start" | "code" — which call is pending
  const [waited, setWaited] = useState(0);   // seconds waited, so a long call still looks alive
  const [label, setLabel] = useState("");
  const [loginId, setLoginId] = useState(null);
  const [url, setUrl] = useState("");
  const [code, setCode] = useState("");
  const [added, setAdded] = useState(null);  // account vừa thêm (hiện xác nhận trước khi đóng)
  const [err, setErr] = useState("");

  // Tick a seconds counter while a call is pending.
  useEffect(() => {
    if (!busy) { setWaited(0); return; }
    const t = setInterval(() => setWaited((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  if (!open) return null;

  const reset = () => {
    setStep("label"); setBusy(""); setWaited(0); setLabel(""); setLoginId(null);
    setUrl(""); setCode(""); setAdded(null); setErr("");
  };
  const close = () => { if (busy) return; reset(); onClose(); }; // không cho đóng giữa lúc đang chờ

  const start = async () => {
    setErr(""); setBusy("start");
    try {
      const r = await fetch("/api/accounts/login/start", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(relogin ? { accountId: relogin.id } : { label }),
      });
      const j = await r.json();
      if (!r.ok || !j.url) throw new Error(j.error || "Không lấy được URL");
      setLoginId(j.loginId); setUrl(j.url); setStep("code");
      // KHÔNG tự mở tab ở đây (issue 12): claude CLI đã tự mở trình duyệt -> tránh mở 2 tab.
      // Nếu CLI không mở, người dùng bấm link "mở link đăng nhập ↗" trong modal.
    } catch (e) { setErr(String(e.message)); }
    finally { setBusy(""); }
  };

  const submitCode = async () => {
    setErr(""); setBusy("code");
    try {
      const r = await fetch("/api/accounts/login/code", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ loginId, code }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Đăng nhập thất bại");
      // Xác nhận thành công rồi mới đóng, thay vì biến mất đột ngột.
      const id = j.account?.id || relogin?.id || null;
      setAdded(j.account || relogin || null); setStep("done"); setBusy("");
      onDone(id); // báo ngay để danh sách + usage của account này được nạp lại
      setTimeout(() => { reset(); onClose(); }, 1200);
    } catch (e) { setErr(String(e.message)); setBusy(""); }
  };

  const waitNote = busy === "start"
    ? "Đang chạy `claude auth login` và chờ link đăng nhập (tối đa ~12 giây)…"
    : "Đang gửi code cho Claude CLI và chờ xác nhận (có thể mất ~20 giây). Đừng đóng cửa sổ.";

  return (
    <div className="modal-bg" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>{relogin ? `🔑 Đăng nhập lại: ${relogin.label}` : "👤 Thêm account Claude"}</span>
          <button onClick={close} disabled={!!busy} title={busy ? "Đang xử lý…" : "Đóng"}>✕</button>
        </div>

        {step === "label" && !relogin && (
          <label className="fld">
            <span>Tên gợi nhớ cho account <em className="fld-opt">(tuỳ chọn)</em></span>
            <input value={label} onChange={(e) => setLabel(e.target.value)}
              placeholder="để trống = hiển thị email của tài khoản" disabled={!!busy} />
          </label>
        )}
        {step === "label" && relogin && <div className="modal-req">Token của <b>{relogin.label}</b> đã hết hạn. Bấm để lấy link đăng nhập lại vào đúng account cũ.</div>}

        {step === "code" && (
          <>
            <div className="modal-req">
              Đã mở trình duyệt để đăng nhập. Nếu chưa mở, bấm:
              <a href={url} target="_blank" rel="noreferrer"> mở link đăng nhập ↗</a>.
              Đăng nhập xong, copy <b>code</b> và dán vào đây.
            </div>
            <label className="fld">
              <span>Code xác thực</span>
              <input autoFocus value={code} onChange={(e) => setCode(e.target.value)}
                placeholder="dán code ở đây" disabled={!!busy} />
            </label>
          </>
        )}

        {step === "done" && (
          <div className="modal-ok">
            ✓ Đã {relogin ? "đăng nhập lại" : "thêm"} account{added?.label ? ` "${added.label}"` : ""} — đang cập nhật usage…
          </div>
        )}

        {busy && (
          <div className="modal-busy">
            <span className="spinner" aria-hidden="true" />
            <span>{waitNote} <b>{waited}s</b></span>
          </div>
        )}

        {err && <div className="modal-err">{err}</div>}

        <div className="modal-foot">
          <span className="run-preview">{busy ? "Đang xử lý…" : ""}</span>
          {step === "code"
            ? <button className="primary" disabled={!code.trim() || !!busy} onClick={submitCode}>
                {busy === "code" ? "⏳ Đang xác thực…" : "✓ Xác nhận & thêm"}</button>
            : step === "label"
              ? <button className="primary" disabled={!!busy} onClick={start}>
                  {busy === "start" ? "⏳ Đang lấy link…" : "▶ Lấy link đăng nhập"}</button>
              : null}
        </div>
      </div>
    </div>
  );
}
