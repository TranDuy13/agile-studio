import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Console — xem trực tiếp Claude đang làm gì, và dò lại các bước dẫn đến lỗi.
//
// Vì sao có màn này: trước đó chỗ duy nhất thấy được hoạt động là một khung 9 dòng, mỗi dòng là
// bản rút gọn 400 ký tự, giữ trong RAM của trình duyệt. Job chết là mất hết — ca 11 lỗi mà không
// có gì để xem chính là chuyện đó. Ở đây mỗi dòng đến từ run.log trên đĩa và mở ra được để đọc
// tham số tool, toàn văn Claude nói, hay stderr.
//
// Dùng ở hai chỗ (`variant`):
//   "tab"   — tab Console, cao hết màn, có đủ bộ lọc
//   "inline"— khung Hoạt động ở cột nội dung, thấp, bấm ⛶ để phình ra fullscreen
//
// Nguồn dữ liệu là hai đường bù nhau: nạp một lần khi mở (đĩa, sống sót restart) rồi sống bằng
// event WS. `after=lastSeq` để reconnect không vẽ lại nghìn dòng đã có.

const KIND = {
  run:         { ic: "▶", cls: "k-run",  label: "lượt chạy" },
  "run-error": { ic: "✖", cls: "k-err",  label: "lỗi lượt chạy" },
  spawn:       { ic: "▶", cls: "k-run",  label: "khởi động CLI" },
  info:        { ic: "·", cls: "k-info", label: "thông tin" },
  system:      { ic: "⚙", cls: "k-info", label: "system" },
  text:        { ic: "💬", cls: "k-text", label: "Claude nói" },
  tool:        { ic: "🔧", cls: "k-tool", label: "gọi tool" },
  tool_result: { ic: "↩", cls: "k-res",  label: "tool trả về" },
  tool_error:  { ic: "✖", cls: "k-err",  label: "tool báo lỗi" },
  result:      { ic: "✓", cls: "k-ok",   label: "hết lượt hội thoại" },
  stderr:      { ic: "⚠", cls: "k-err",  label: "stderr" },
  stdout:      { ic: "▫", cls: "k-info", label: "stdout thô" },
  exit:        { ic: "■", cls: "k-exit", label: "mã thoát" },
};
const kindOf = (k) => KIND[k] || { ic: "·", cls: "k-info", label: k || "?" };

const FILTERS = [
  { id: "", label: "Tất cả" },
  { id: "problem", label: "Chỉ chỗ vướng" },
  { id: "tool,tool_result,tool_error", label: "Tool" },
  { id: "text", label: "Claude nói" },
];

const hms = (t) => new Date(t).toLocaleTimeString("vi-VN", { hour12: false })
  + "." + String(new Date(t).getMilliseconds()).padStart(3, "0");
const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(0, Math.round(n / 1024)) + " KB");

export default function RunConsole({ jobId, variant = "tab", live = false, onClose }) {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ sessions: [], bytes: 0, file: "", state: "never", note: null });
  const [kind, setKind] = useState("");
  const [session, setSession] = useState("");
  const [stick, setStick] = useState(true);          // khoá cuộn ở đáy
  const [open, setOpen] = useState(() => new Set()); // seq của dòng đang mở detail
  const [full, setFull] = useState(false);           // chỉ dùng ở variant inline
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const seqRef = useRef(0);
  const boxRef = useRef(null);

  // Nạp lại từ đầu khi đổi bộ lọc: lọc chạy ở server nên đổi bộ lọc là đổi tập dữ liệu.
  const reload = useCallback(async () => {
    setBusy(true);
    const p = new URLSearchParams({ limit: "800" });
    if (kind) p.set("kind", kind);
    if (session) p.set("session", session);
    const d = await fetch(`/api/doc-jobs/${jobId}/log?${p}`).then((r) => r.json())
      .catch((e) => ({ error: String(e.message) }));
    setBusy(false);
    if (d.error) return setErr(d.error);
    setErr("");
    setRows(d.entries || []);
    setMeta({ sessions: d.sessions || [], bytes: d.bytes || 0, file: d.file || "",
      state: d.state || "never", note: d.note || null, host: d.host, ranHost: d.ranHost });
    seqRef.current = d.lastSeq || 0;
  }, [jobId, kind, session]);

  useEffect(() => { reload(); }, [reload]);

  // Realtime. Bộ lọc phải áp lại ở client cho event mới, nếu không dòng bị lọc vẫn nhảy vào.
  useEffect(() => {
    let ws;
    try { ws = new WebSocket(`ws://${location.host.replace("5311", "4311")}`); } catch { return; }
    ws.onmessage = (m) => {
      let e; try { e = JSON.parse(m.data); } catch { return; }
      if (e.type !== "doc:log" || e.jobId !== jobId || !e.entry) return;
      const row = e.entry;
      seqRef.current = Math.max(seqRef.current, row.seq || 0);
      if (session && row.session !== session) return;
      if (kind) {
        const problem = ["stderr", "tool_error", "exit", "run-error", "error"];
        const want = kind === "problem" ? problem : kind.split(",");
        if (!want.includes(row.kind)) return;
      }
      setRows((prev) => {
        const next = prev.concat(row);
        return next.length > 1200 ? next.slice(-1200) : next;
      });
      setMeta((prev) => row.session && !prev.sessions.includes(row.session)
        ? { ...prev, sessions: prev.sessions.concat(row.session) } : prev);
    };
    return () => { try { ws.close(); } catch { /* đã đóng */ } };
  }, [jobId, kind, session]);

  // Cuộn xuống đáy khi có dòng mới, nhưng chỉ khi người dùng chưa tự cuộn lên đọc.
  useEffect(() => {
    if (!stick || !boxRef.current) return;
    boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [rows, stick]);

  // Tự bỏ khoá cuộn khi người dùng cuộn lên — không ai muốn bị kéo về đáy giữa lúc đang đọc.
  const onScroll = () => {
    const el = boxRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (atBottom !== stick) setStick(atBottom);
  };

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => (r.text || "").toLowerCase().includes(needle)
      || (r.detail || "").toLowerCase().includes(needle));
  }, [rows, q]);

  const toggle = (seq) => setOpen((s) => {
    const n = new Set(s);
    n.has(seq) ? n.delete(seq) : n.add(seq);
    return n;
  });

  const download = () => {
    const p = new URLSearchParams();
    if (session) p.set("session", session);
    const qs = p.toString();
    window.open(`/api/doc-jobs/${jobId}/log/download${qs ? "?" + qs : ""}`, "_blank");
  };

  const clear = async () => {
    if (!confirm("Xoá toàn bộ log của bộ tài liệu này? Không hoàn lại được.")) return;
    const r = await fetch(`/api/doc-jobs/${jobId}/log`, { method: "DELETE" })
      .then((x) => x.json()).catch((e) => ({ error: String(e.message) }));
    if (r.error) return setErr(r.error);
    setRows([]); seqRef.current = 0; reload();
  };

  const inline = variant === "inline";
  const tokens = rows.filter((r) => r.tokens).at(-1)?.tokens || 0;

  const bar = (
    <div className="dg-con-bar">
      <span className="dg-label">{inline ? "Hoạt động" : "Console"}</span>
      {live && <span className="pill run">● đang chạy</span>}

      <select className="dg-inp mini" value={kind} onChange={(e) => setKind(e.target.value)}
        title="Lọc theo loại event">
        {FILTERS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
      </select>

      {meta.sessions.length > 1 && (
        <select className="dg-inp mini" value={session} onChange={(e) => setSession(e.target.value)}
          title="Chạy song song thì mỗi tài liệu/mục là một phiên riêng">
          <option value="">Mọi phiên</option>
          {meta.sessions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      )}

      <input className="dg-inp mini dg-con-q" value={q} placeholder="tìm trong log…"
        onChange={(e) => setQ(e.target.value)} />

      <span className="dg-spacer" />

      <label className="dg-con-stick" title="Tự cuộn xuống dòng mới nhất">
        <input type="checkbox" checked={stick} onChange={(e) => setStick(e.target.checked)} />
        khoá cuộn
      </label>
      <button className="mini" onClick={download} disabled={meta.state !== "ok"}
        title={meta.state === "ok" ? "Tải run.log về dạng văn bản" : meta.note || "Không có log để tải"}>
        ⬇ Tải log
      </button>
      {!inline && <button className="mini danger" onClick={clear} title="Xoá log của bộ này">🗑</button>}
      {inline && (
        <button className="mini" onClick={() => setFull((v) => !v)}
          title={full ? "Thu về cột nội dung" : "Phình ra toàn màn hình"}>{full ? "⤡ thu" : "⛶ to"}</button>
      )}
      {onClose && !inline && <button className="mini" onClick={onClose}>✕</button>}
    </div>
  );

  const list = (
    <div className={"dg-con-list" + (inline && !full ? " short" : "")} ref={boxRef} onScroll={onScroll}>
      {err && <div className="dg-err">{err}</div>}
      {/* Bốn lý do khác nhau cho cùng một cái "không có dòng nào". Nói chung một câu là cách nhanh
          nhất để người dùng tưởng tính năng hỏng — đặc biệt khi job đến từ database dùng chung mà
          log là tệp cục bộ. Server quyết định `state`, ở đây chỉ vẽ. */}
      {!shown.length && !busy && (rows.length ? (
        <p className="dg-muted">Không có dòng nào khớp bộ lọc.</p>
      ) : meta.state === "other-host" ? (
        <div className="dg-con-empty warn">
          <b>🖥 Log của lượt chạy này nằm ở máy khác</b>
          <p>{meta.note}</p>
          <p className="dg-dim">Bộ tài liệu, dàn ý và nội dung thì có đầy đủ ở đây — chỉ log phiên
            agent là không, vì nó là tệp trên đĩa chứ không nằm trong cơ sở dữ liệu.</p>
          <code className="dg-con-path">{meta.file}</code>
        </div>
      ) : meta.state === "missing" ? (
        <div className="dg-con-empty warn">
          <b>📄 Không còn tệp log</b>
          <p>{meta.note}</p>
          <p className="dg-dim">Nội dung đã viết vẫn còn nguyên. Chạy thêm một lượt là có log mới —
            hoặc xem lý do vắn tắt ở hộp lỗi của bộ tài liệu nếu lượt trước bị dừng.</p>
          <code className="dg-con-path">{meta.file}</code>
        </div>
      ) : meta.state === "unreadable" ? (
        <div className="dg-con-empty err">
          <b>🔒 Có tệp log nhưng đọc không được</b>
          <p>{meta.note}</p>
          <code className="dg-con-path">{meta.file}</code>
        </div>
      ) : (
        <div className="dg-con-empty">
          <p>Chưa có log cho bộ tài liệu này. Log được ghi từ lúc bấm <b>Khảo sát</b> hoặc
            <b> Bắt đầu viết</b>.</p>
          {meta.file && <p className="dg-dim">Nó là một tệp trên đĩa, <b>không</b> nằm trong cơ sở dữ
            liệu — nên còn nguyên sau khi server khởi động lại, nhưng cũng <b>không</b> đi theo sang
            máy khác:<br /><code className="dg-con-path">{meta.file}</code></p>}
        </div>
      ))}
      {shown.map((r) => {
        const k = kindOf(r.kind);
        const isOpen = open.has(r.seq);
        return (
          <div className={"dg-con-row " + k.cls + (isOpen ? " open" : "") + (r.detail ? " has-detail" : "")}
            key={r.seq}>
            <button className="dg-con-head" onClick={() => r.detail && toggle(r.seq)}
              title={r.detail ? (isOpen ? "Thu gọn" : "Mở xem chi tiết") : k.label}>
              <i className="dg-con-caret">{r.detail ? (isOpen ? "▾" : "▸") : " "}</i>
              <time>{hms(r.t)}</time>
              <i className="dg-con-ic" title={k.label}>{k.ic}</i>
              {r.session && <em className="dg-con-ses">{r.session}</em>}
              <span className="dg-con-txt">{r.text || <em className="dg-dim">(không có nội dung)</em>}</span>
              {r.code !== undefined && r.code !== 0 && <span className="pill err">exit {r.code}</span>}
            </button>
            {isOpen && r.detail && <pre className="dg-con-detail">{r.detail}</pre>}
          </div>
        );
      })}
    </div>
  );

  const foot = (
    <div className="dg-con-foot">
      <span>{shown.length}{shown.length !== rows.length ? `/${rows.length}` : ""} dòng</span>
      {meta.bytes > 0 && <span>· log {kb(meta.bytes)}</span>}
      {tokens > 0 && <span>· {tokens.toLocaleString("vi-VN")} token</span>}
      {meta.file && <span className="dg-dim" title={"Tệp log trên đĩa — không nằm trong cơ sở dữ liệu:\n"
        + meta.file}>· 📄 tệp trên đĩa</span>}
      <span className="dg-spacer" />
      <span className="dg-dim">Bấm một dòng có ▸ để xem tham số tool, toàn văn Claude nói, hoặc stderr.</span>
    </div>
  );

  if (inline) {
    return (
      <div className={"dg-con inline" + (full ? " full" : "")}>
        {bar}{list}{foot}
      </div>
    );
  }
  return <section className="dg-card dg-con">{bar}{list}{foot}</section>;
}
