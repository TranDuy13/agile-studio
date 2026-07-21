import React, { useCallback, useEffect, useState } from "react";

// Trạng thái kết nối của các thành phần cấu hình ngoài app (issue 17):
//   • Storage  — json / sqlite / postgres (theo .env)
//   • Discord bot — tiến trình riêng, tự báo trạng thái về server
// Bấm vào một dòng để xem LÝ DO khi hỏng và bấm "Thử lại" (hoặc tải lại trang) ngay tại chỗ.

const DOT = { ok: "ok", warn: "warn", error: "err", down: "err", off: "off" };
const LABEL = { ok: "đã kết nối", warn: "cảnh báo", error: "lỗi", down: "không chạy", off: "chưa cấu hình" };
const HINT = {
  start: "Chạy `npm run bot` (hoặc `npm run dev`) để bật lại tiến trình bot.",
  env: "Sửa `.env` rồi khởi động lại tiến trình tương ứng.",
  retry: "Sửa nguyên nhân ở trên rồi bấm Thử lại.",
};
const ago = (t) => (t ? `${Math.max(0, Math.round((Date.now() - t) / 1000))}s trước` : "—");

function Row({ id, icon, title, sub, state, onOpen }) {
  return (
    <button className="integ-row" onClick={() => onOpen(id)} title="Xem chi tiết / thử lại">
      <span className={"integ-dot d-" + (DOT[state] || "off")} />
      <span className="integ-name">{icon} {title}</span>
      <span className="integ-sub">{sub}</span>
    </button>
  );
}

export default function IntegrationStatus({ version }) {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(null); // "storage" | "bot"
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [reveal, setReveal] = useState(false); // hiện chuỗi kết nối DB (mặc định che)

  const load = useCallback((probe) =>
    fetch("/api/integrations" + (probe ? "?probe=1" : "")).then((r) => r.json()).then(setData).catch(() => {}), []);

  useEffect(() => { load(true); }, [load, version]);
  useEffect(() => { const t = setInterval(() => load(true), 20000); return () => clearInterval(t); }, [load]);

  const retry = async (name) => {
    setBusy(true); setNote("");
    try {
      const r = await fetch(`/api/integrations/${name}/retry`, { method: "POST" }).then((x) => x.json());
      setNote(r.ok ? (r.note || "✓ Kết nối lại thành công.") : "✖ " + (r.error || "Vẫn chưa kết nối được."));
      await load(true);
      if (name === "bot") setTimeout(() => load(true), 3000); // bot cần vài giây để đăng nhập lại
    } catch (e) { setNote("✖ " + String(e.message)); }
    finally { setBusy(false); }
  };

  if (!data) return null;
  const s = data.storage, b = data.bot;
  const cur = open === "storage" ? s : open === "bot" ? b : null;
  // Chỉ cho "Thử lại" khi thực sự có tác dụng: storage phải là postgres VÀ đang lỗi
  // (json/sqlite cục bộ, hoặc đang OK, thì bấm lại vô nghĩa); bot thì khi chưa kết nối.
  const canRetry = cur && (open === "storage"
    ? (s.state !== "ok" && s.driver === "postgres")
    : b.state !== "ok");
  // Chuỗi đích của storage nhạy cảm (host/DB) — che, có nút con mắt để xem.
  const target = s.target || "";
  const masked = target.replace(/./g, "•");

  return (
    <div className="integs">
      <div className="acct-title"><span>Kết nối</span></div>
      <Row id="storage" icon="🗄" title={"Storage · " + s.driver} state={s.state} onOpen={(x) => { setNote(""); setReveal(false); setOpen(x); }}
        sub={s.state === "ok" ? (s.concurrent ? "chia sẻ nhiều máy" : "cục bộ") : LABEL[s.state]} />
      <Row id="bot" icon="🤖" title="Discord bot" state={b.state} onOpen={(x) => { setNote(""); setReveal(false); setOpen(x); }}
        sub={b.state === "ok" ? (b.user || "online") : LABEL[b.state]} />

      {cur && (
        <div className="modal-bg" onClick={() => setOpen(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <span>{open === "storage" ? "🗄 Storage" : "🤖 Discord bot"}</span>
              <button onClick={() => setOpen(null)}>✕</button>
            </div>

            <div className="acct-info">
              <div className="acct-info-row"><span>Trạng thái</span>
                <b className={"integ-state d-" + (DOT[cur.state] || "off")}>{LABEL[cur.state] || cur.state}</b></div>
              {open === "storage" ? (
                <>
                  <div className="acct-info-row"><span>Driver</span><b>{s.driver}</b></div>
                  <div className="integ-target">
                    <div className="integ-target-head">
                      <span>Đích</span>
                      <button className="eye-btn" onClick={() => setReveal((v) => !v)}
                        title={reveal ? "Ẩn" : "Hiện chuỗi kết nối"} aria-label={reveal ? "Ẩn" : "Hiện"}>
                        {reveal ? "🙈" : "👁"}</button>
                    </div>
                    <code className="integ-target-val">{reveal ? target : masked}</code>
                  </div>
                  <div className="acct-info-row"><span>Dùng chung nhiều máy</span><b>{s.concurrent ? "có (merge + poll 4s)" : "không"}</b></div>
                  <div className="acct-info-row"><span>File tài liệu lưu trong DB</span><b>{s.filesInStore ? "có" : "không (chỉ trên đĩa)"}</b></div>
                  <div className="acct-info-row"><span>Ghi thành công lần cuối</span><b>{ago(s.lastOkAt)}</b></div>
                  {s.lastErrorAt && <div className="acct-info-row"><span>Lỗi gần nhất</span><b>{ago(s.lastErrorAt)}</b></div>}
                </>
              ) : (
                <>
                  <div className="acct-info-row"><span>Bot</span><b>{b.user || "—"}</b></div>
                  <div className="acct-info-row"><span>Server Discord</span><b>{b.guilds || 0}</b></div>
                  <div className="acct-info-row"><span>Channel</span><b>{b.channelId || "(chưa đặt)"}{b.channelOk === false ? " · không đọc được" : b.channelOk ? " · ok" : ""}</b></div>
                  <div className="acct-info-row"><span>Prefix</span><b>{b.prefix || "—"}</b></div>
                  <div className="acct-info-row"><span>Kết nối WS tới server</span><b>{b.wsConnected ? "có" : "không"}</b></div>
                  <div className="acct-info-row"><span>Báo trạng thái lần cuối</span><b>{b.reportedAt ? ago(b.reportedAt) : "chưa từng"}</b></div>
                </>
              )}
            </div>

            {cur.reason ? <div className={cur.state === "ok" ? "modal-req" : "modal-err"}>{cur.reason}</div>
              : <div className="modal-ok">✓ Kết nối bình thường.</div>}
            {cur.hint && HINT[cur.hint] && <div className="modal-req">{HINT[cur.hint]}</div>}
            {note && <div className={note.startsWith("✓") ? "modal-ok" : "modal-err"}>{note}</div>}

            <div className="modal-foot">
              <button className="ghost-btn" onClick={() => location.reload()}>⟳ Tải lại trang</button>
              {canRetry
                ? <button className="primary" disabled={busy} onClick={() => retry(open)}>
                    {busy ? "⏳ Đang thử lại…" : "↻ Thử lại kết nối"}</button>
                : <button className="primary" onClick={() => setOpen(null)}>Đóng</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
