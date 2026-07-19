import React, { useState } from "react";

// Modal đăng nhập account: nhập label -> lấy URL -> mở & authorize -> dán code -> tự thêm.
// relogin (tuỳ chọn): account đang hết hạn -> đăng nhập lại vào đúng configDir cũ.
export default function AccountLogin({ open, onClose, onDone, relogin }) {
  const [step, setStep] = useState("label"); // label | code | busy
  const [label, setLabel] = useState("");
  const [loginId, setLoginId] = useState(null);
  const [url, setUrl] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  if (!open) return null;

  const reset = () => { setStep("label"); setLabel(""); setLoginId(null); setUrl(""); setCode(""); setErr(""); };
  const close = () => { reset(); onClose(); };

  const start = async () => {
    setErr(""); setStep("busy");
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
    } catch (e) { setErr(String(e.message)); setStep("label"); }
  };

  const submitCode = async () => {
    setErr(""); setStep("busy");
    try {
      const r = await fetch("/api/accounts/login/code", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ loginId, code }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Đăng nhập thất bại");
      onDone(); close();
    } catch (e) { setErr(String(e.message)); setStep("code"); }
  };


  return (
    <div className="modal-bg" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><span>{relogin ? `🔑 Đăng nhập lại: ${relogin.label}` : "👤 Thêm account Claude"}</span><button onClick={close}>✕</button></div>

        {step !== "code" && !relogin && (
          <label className="fld">
            <span>Tên gợi nhớ cho account <em className="fld-opt">(tuỳ chọn)</em></span>
            <input value={label} onChange={(e) => setLabel(e.target.value)}
              placeholder="để trống = hiển thị email của tài khoản" disabled={step === "busy"} />
          </label>
        )}
        {step !== "code" && relogin && <div className="modal-req">Token của <b>{relogin.label}</b> đã hết hạn. Bấm để lấy link đăng nhập lại vào đúng account cũ.</div>}

        {step === "code" && (
          <>
            <div className="modal-req">
              Đã mở trình duyệt để đăng nhập. Nếu chưa mở, bấm:
              <a href={url} target="_blank" rel="noreferrer"> mở link đăng nhập ↗</a>.
              Đăng nhập xong, copy <b>code</b> và dán vào đây.
            </div>
            <label className="fld">
              <span>Code xác thực</span>
              <input autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="dán code ở đây" />
            </label>
          </>
        )}

        {err && <div className="modal-err">{err}</div>}

        <div className="modal-foot">
          <span className="run-preview">{step === "busy" ? "Đang xử lý…" : ""}</span>
          {step === "code"
            ? <button className="primary" disabled={!code.trim() || step === "busy"} onClick={submitCode}>✓ Xác nhận & thêm</button>
            : <button className="primary" disabled={step === "busy"} onClick={start}>▶ Lấy link đăng nhập</button>}
        </div>
      </div>
    </div>
  );
}
