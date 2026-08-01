import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TokenConfirm, { TokenChip, fmtTokens, shouldAsk } from "./TokenConfirm.jsx";
import Dialog, { DialogButtons } from "./Dialog.jsx";
import IrView from "./IrView.jsx";
import SectionEditor from "./SectionEditor.jsx";
import ExportDialog from "./ExportDialog.jsx";
import RunConsole from "./RunConsole.jsx";
import { EconomyChip, EconomyDialog, useEconomy } from "./EconomyChip.jsx";

// MH 4 + MH 7 — watching the agent write, reading and fixing what it wrote, and getting a file out.
//
// Two views of one truth (Q11). `status` on the outline row is the only source for both, so the
// matrix and the detail tree can never disagree. The choice of view is remembered per job: someone
// babysitting a run wants Chi tiết, someone checking a six-file set wants Ma trận.
//
// Layout follows the lesson of the outline screen: the content column gets the width, the rail is
// sticky and holds only numbers, and every grid track is min-width:0 so a long path cannot give the
// whole app a horizontal scrollbar.

const ENGINES = [
  { id: "per-doc", label: "Song song theo tài liệu", sub: "Nhanh · mỗi tài liệu một phiên" },
  { id: "single", label: "Tuần tự một phiên", sub: "Nhất quán thuật ngữ cao nhất · chậm hơn" },
  { id: "per-section", label: "Song song theo mục", sub: "Nhanh nhất · tốn token nhất" },
];

const ST = {
  pending: { cls: "p", ic: "○", label: "chờ" },
  writing: { cls: "w", ic: "✍", label: "đang viết" },
  written: { cls: "d", ic: "✓", label: "xong" },
  edited: { cls: "u", ic: "✎", label: "đã sửa tay" },
  stale: { cls: "s", ic: "●", label: "nguồn đã đổi" },
  error: { cls: "e", ic: "▲", label: "vướng" },
  skipped: { cls: "x", ic: "–", label: "bỏ qua" },
};

const JOB_PILL = {
  writing: ["run", "▶ đang viết"],
  editing: ["ok", "✓ đã viết xong"],
  paused: ["", "⏸ đã tạm dừng"],
  error: ["err", "✖ có mục chưa xong"],
  "plan-approved": ["acc", "⏸ chưa viết"],
  ready: ["ok", "✓ sẵn sàng"],
};

const levelOf = (num) => Math.min(4, String(num).split(".").length);
const mmss = (ms) => {
  const s = Math.max(0, Math.round((ms || 0) / 1000));
  return `${Math.floor(s / 60)}′${String(s % 60).padStart(2, "0")}″`;
};
const numCmp = (a, b) => {
  const pa = String(a).split("."), pb = String(b).split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (Number(pa[i]) || 0) - (Number(pb[i]) || 0);
    if (d) return d;
  }
  return 0;
};

export default function DocProgress({ jobId, settings, onSettings, onBack, onJobChanged }) {
  const [job, setJob] = useState(null);
  const [plan, setPlan] = useState(null);
  const [ir, setIr] = useState({});
  const [metrics, setMetrics] = useState(null);
  const [perDoc, setPerDoc] = useState([]);
  const [exports, setExports] = useState([]);
  const [est, setEst] = useState(null);
  const [python, setPython] = useState(null);
  const [writing, setWriting] = useState(false);
  const [view, setView] = useState(() => localStorage.getItem(`dg:view:${jobId}`) || "detail");
  const [tab, setTab] = useState("progress");
  const [selected, setSelected] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  const [revealDir, setRevealDir] = useState("");   // thư mục vừa xuất, để toast có nút mở
  const [ask, setAsk] = useState(null);          // token dialog: "write" | "rewrite"
  const [dialog, setDialog] = useState(null);
  const timer = useRef(null);
  const eco = useEconomy(settings, onSettings);

  const flash = (m) => { setToast(m); setTimeout(() => setToast(""), 5000); };

  const load = useCallback(async () => {
    const d = await fetch(`/api/doc-jobs/${jobId}/ir`).then((r) => r.json()).catch((e) => ({ error: String(e.message) }));
    if (d.error) return setErr(d.error);
    setJob(d.job); setPlan(d.plan); setIr(d.ir || {}); setMetrics(d.metrics);
    setPerDoc(d.perDoc || []); setExports(d.exports || []); setWriting(!!d.writing);
    fetch(`/api/doc-jobs/${jobId}/estimate?usage=1`).then((r) => r.json()).then(setEst).catch(() => {});
  }, [jobId]);

  // Coalesce: a per-section run emits three events a second and each one would otherwise be a
  // full reload of the outline.
  const reload = useCallback(() => {
    if (timer.current) return;
    timer.current = setTimeout(() => { timer.current = null; load(); }, 400);
  }, [load]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetch("/api/doc-tools").then((r) => r.json()).then((d) => setPython(d.python)).catch(() => {}); }, []);

  // Đổi chế độ tiết kiệm là đổi cả số mục lượt tới viết và cả dự báo token — nút phải nói lại con số
  // mới ngay, không đợi tới lần tải màn sau.
  const ecoKey = JSON.stringify(settings?.economy || null);
  useEffect(() => {
    fetch(`/api/doc-jobs/${jobId}/estimate?usage=1`).then((r) => r.json()).then(setEst).catch(() => {});
  }, [jobId, ecoKey]);

  // Stale detection runs when the job is opened (Q21) — free, and the answer is stale itself if we
  // wait for the user to ask.
  useEffect(() => {
    fetch(`/api/doc-jobs/${jobId}/stale`, { method: "POST" }).then((r) => r.json())
      .then((d) => { if (d.changed) reload(); }).catch(() => {});
  }, [jobId, reload]);

  useEffect(() => {
    let ws;
    try { ws = new WebSocket(`ws://${location.host.replace("5311", "4311")}`); } catch { return; }
    ws.onmessage = (m) => {
      let e; try { e = JSON.parse(m.data); } catch { return; }
      if (e.jobId && e.jobId !== jobId) return;
      // doc:activity và doc:log đều là dòng hoạt động — RunConsole tự lắng nghe doc:log, nên ở đây
      // chỉ cần bỏ qua chúng, không reload cả màn cho từng dòng.
      if (e.type === "doc:activity" || e.type === "doc:log") return;
      if (e.type === "doc:section" || e.type === "doc:job" || e.type === "doc:export") reload();
    };
    return () => { try { ws.close(); } catch { /* already closed */ } };
  }, [jobId, reload]);

  useEffect(() => { localStorage.setItem(`dg:view:${jobId}`, view); }, [view, jobId]);

  const sections = useMemo(
    () => (plan?.docs || []).flatMap((d) => (d.sections || []).map((s) => ({ ...s, docKey: d.key, docFile: d.file }))),
    [plan]);
  const live = sections.find((s) => s.status === "writing");
  const current = sections.find((s) => s.id === selected)
    || live
    || sections.find((s) => ir[`${s.docKey}/${s.num}`])
    || sections[0] || null;
  const currentIr = current ? ir[`${current.docKey}/${current.num}`] : null;

  const staleAll = sections.filter((s) => s.status === "stale");
  const staleBulk = staleAll.filter((s) => !s.edited);

  const post = async (url, body) => {
    const r = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then((x) => x.json()).catch((e) => ({ error: String(e.message) }));
    return r;
  };

  const startWrite = async (only) => {
    setBusy("write"); setErr("");
    const r = await post(`/api/doc-jobs/${jobId}/write`, only ? { only } : {});
    setBusy("");
    if (r.error) return setErr(r.error);
    // Nói thẳng số mục bị hoãn: im lặng làm ít hơn số vừa hiện trên nút là cách nhanh nhất để
    // người dùng tưởng tính năng hỏng.
    flash(`Đang viết ${r.sections} mục · ${ENGINES.find((e) => e.id === r.engine)?.label}.`
      + (r.deferred ? ` Chế độ tiết kiệm hoãn ${r.deferred} mục sang lượt sau — bấm Tiếp tục khi xong.` : ""));
    reload(); onJobChanged?.();
  };

  const stop = async () => {
    setBusy("stop");
    const r = await post(`/api/doc-jobs/${jobId}/stop`);
    setBusy("");
    if (r.error) setErr(r.error);
    else { flash("Đã yêu cầu dừng — các mục đã viết vẫn được giữ."); reload(); }
  };

  const changeEngine = async (engine) => {
    const r = await fetch(`/api/doc-jobs/${jobId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run: { engine } }),
    }).then((x) => x.json()).catch((e) => ({ error: String(e.message) }));
    if (r.error) return setErr(r.error);
    setJob(r.job);
    flash(r.switched
      ? "Đã đổi cách chạy — phiên thừa dừng gọn, mục đã viết giữ nguyên, viết tiếp từ mục dang dở."
      : "Đã đổi cách chạy cho lượt viết sau.");
    onJobChanged?.();
  };

  const refreshStale = async () => {
    setBusy("stale");
    const r = await post(`/api/doc-jobs/${jobId}/stale`);
    setBusy("");
    if (r.error) return setErr(r.error);
    reload();
    flash(r.error ? r.error
      : r.stale.length
        ? `${r.stale.length} mục đang trỏ tới tệp đã đổi kể từ lần viết${r.stale.some((x) => x.edited) ? " (có mục đã sửa tay — phải chọn riêng)" : ""}.`
        : `Không có mục nào đã cũ. Đã đối chiếu ${r.checked} mục với commit ${r.head}.`);
  };

  const saveEdit = async ({ blocks, traces }) => {
    const r = await fetch(`/api/doc-jobs/${jobId}/ir`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: current.id, blocks, traces }),
    }).then((x) => x.json()).catch((e) => ({ error: String(e.message) }));
    if (r.error) return r.error;
    setDialog(null);
    reload(); onJobChanged?.();
    flash(`Đã lưu mục ${current.num} — mục này giờ mang dấu “đã sửa tay”, agent sẽ không ghi đè.`);
    return null;
  };

  const unedit = async () => {
    const r = await post(`/api/doc-jobs/${jobId}/ir/unedit`, { id: dialog.section.id });
    setDialog(null);
    if (r.error) return setErr(r.error);
    reload(); onJobChanged?.();
    flash("Đã bỏ đánh dấu — lần viết tới agent sẽ ghi đè mục này.");
  };

  // Mở thư mục. Luôn nói ra kết quả — kể cả khi thành công.
  //
  // Vì sao phải nói: cửa sổ Explorer mở ra nằm SAU trình duyệt (Windows không cho tiến trình nền
  // giành foreground) nên "thành công" trông y hệt "không có gì xảy ra". Đã đo: một lần bấm là một
  // cửa sổ mới, đúng đường dẫn — người dùng chỉ không nhìn thấy nó. Im lặng ở đây khiến người ta
  // bấm tiếp và mở ra bốn cửa sổ chồng nhau.
  const reveal = async (path) => {
    const r = await post("/api/doc-dests/reveal", { path });
    if (r.error) return setErr(`Không mở được thư mục: ${r.error}. Dùng nút 📋 để chép đường dẫn.`);
    flash(r.host && r.host !== location.hostname && location.hostname !== "localhost"
      ? `Đã mở thư mục trên máy chạy server (${r.host}) — không phải máy này. Dùng 📋 để chép đường dẫn.`
      : "Đã mở thư mục — cửa sổ có thể nằm sau trình duyệt, xem trên thanh tác vụ.");
  };

  // Chép đường dẫn. `navigator.clipboard` chỉ có trong secure context: mở Studio bằng `localhost`
  // thì được, nhưng bằng IP LAN (`http://192.168.x.x:5311`) thì KHÔNG — mà đó lại đúng là lúc nút
  // "mở thư mục" vô dụng nhất. Nên phải có đường lùi bằng `execCommand`.
  const copyPath = async (path) => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(path);
      else {
        const ta = document.createElement("textarea");
        ta.value = path; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        const done = document.execCommand("copy");
        document.body.removeChild(ta);
        if (!done) throw new Error("trình duyệt từ chối");
      }
      flash("Đã chép đường dẫn: " + path);
    } catch (e) {
      setErr(`Không chép được (${e.message}). Đường dẫn: ${path}`);
    }
  };

  const runExport = async (payload) => {
    const r = await post(`/api/doc-jobs/${jobId}/export`, payload);
    if (r.error) return r.error;
    setDialog(null);
    setExports(r.exports || []);
    const n = r.export.files.length;
    const skipped = r.export.skipped || [];
    // `r.destDir` là thư mục THẬT đã ghi (đã cộng thư mục con), không phải cái người dùng chọn.
    const where = r.destDir || payload.destDir;
    flash(n
      ? `Đã xuất ${n} tệp vào ${where}`
        + (skipped.length ? ` · bỏ qua ${skipped.length} tệp đang mở/bị khoá` : "")
      : `Không xuất được tệp nào — ${skipped.length} tệp đang mở trong Word hoặc bị khoá. `
        + "Đóng tệp rồi xuất lại; danh sách ở dưới.");
    if (n) setRevealDir(where);
    setTab("export");
    reload();
    return null;
  };

  if (err && !plan) return (
    <div className="dg-pane">
      <div className="dg-err">{err}</div>
      <button className="ghost" onClick={onBack}>← Quay lại</button>
    </div>
  );
  if (!plan) return <div className="dg-pane"><p className="dg-muted">Đang tải…</p></div>;

  const [pillCls, pillText] = JOB_PILL[job?.status] || ["", job?.status || ""];
  const pct = metrics?.pct || 0;
  const engine = job?.run?.engine || plan.engine || "per-doc";
  const pendingTokens = est?.pending?.tokens || 0;
  const staleTokens = est?.stale?.tokens || 0;
  // Số mục lượt tới thật sự viết (server đã cắt theo giới hạn tiết kiệm) và số còn lại sau đó.
  const nextN = est?.pending?.sections || 0;
  const leftN = est?.pending?.left ?? nextN;

  return (
    <div className="dg-pane">
      <div className="dg-head">
        <button className="mini" onClick={onBack}>← Danh sách</button>
        <b className="dg-h1">{job?.name}</b>
        <span className="pill acc">{job?.standardLabel}</span>
        <span className={"pill " + pillCls}>{pillText}</span>
        <span className="pill">{pct}% · {metrics?.done}/{metrics?.sections} mục</span>
        <span className="dg-spacer" />
        <div className="dg-tabs">
          <button className={tab === "progress" ? "on" : ""} onClick={() => setTab("progress")}>Tiến độ</button>
          <button className={tab === "export" ? "on" : ""} onClick={() => setTab("export")}>Xuất bản</button>
          <button className={tab === "console" ? "on" : ""} onClick={() => setTab("console")}
            title="Xem trực tiếp Claude đang làm gì, và dò lại các bước dẫn đến lỗi">
            Console{writing ? " ●" : ""}
          </button>
        </div>
        <button className="primary" onClick={() => setDialog({ kind: "export" })}>⬇ Xuất…</button>
      </div>

      <div className="dg-runbar">
        <label className="dg-engine" title="Đổi được ngay khi đang chạy: phiên thừa dừng gọn, mục đã viết giữ nguyên">
          <span className="dg-label">Cách chạy</span>
          <select className="dg-inp" value={engine} onChange={(e) => changeEngine(e.target.value)}>
            {ENGINES.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
          </select>
        </label>

        {/* The live-run flag from the server decides which button shows, not the stored status: a
            job left in "writing" by a crash (or by the sample data) must still offer Tiếp tục. */}
        {writing ? (
          <button className="ghost" disabled={busy === "stop"} onClick={stop}>
            {busy === "stop" ? "Đang dừng…" : "⏸ Tạm dừng"}
          </button>
        ) : (
          <button className="primary" disabled={busy === "write" || !nextN}
            onClick={() => (shouldAsk("write", pendingTokens, settings) ? setAsk("write") : startWrite(null))}>
            {busy === "write" ? "Đang khởi động…"
              : metrics?.done ? `▶ Tiếp tục · ${nextN} mục`
              : `▶ Bắt đầu viết · ${nextN} mục`}
            {leftN > nextN ? <span className="dg-dim"> (còn {leftN - nextN} đợi lượt sau)</span> : null}
            {" "}<TokenChip tokens={pendingTokens} threshold={settings?.tokenThreshold} />
          </button>
        )}

        <EconomyChip economy={eco.economy} onChange={eco.patch} onConfigure={eco.openDialog} />

        <button className="ghost" disabled={busy === "stale"} onClick={refreshStale}
          title="Đối chiếu nguồn của từng mục với HEAD hiện tại bằng git diff">
          ↻ Tìm mục đã cũ
        </button>

        {staleBulk.length > 0 && (
          <button className="ghost"
            onClick={() => (shouldAsk("rewrite", staleTokens, settings)
              ? setAsk("rewrite") : startWrite(staleBulk.map((s) => s.id)))}>
            ✎ Viết lại {staleBulk.length} mục đã cũ{" "}
            <TokenChip tokens={staleTokens} threshold={settings?.tokenThreshold} />
          </button>
        )}
        {est?.stale?.held > 0 && (
          <span className="dg-sub" title="Mục vừa đã cũ vừa đã sửa tay không nằm trong lượt viết lại hàng loạt">
            {est.stale.held} mục đã cũ nhưng đã sửa tay — phải chọn riêng
          </span>
        )}

        {tab === "progress" && (
          <div className="dg-viewsw">
            <button className={view === "detail" ? "on" : ""} onClick={() => setView("detail")}>Chi tiết</button>
            <button className={view === "matrix" ? "on" : ""} onClick={() => setView("matrix")}>Ma trận</button>
          </div>
        )}
      </div>

      {toast && (
        <div className="dg-toast">✅ {toast}
          {revealDir && <PathActions path={revealDir} onReveal={reveal} onCopy={copyPath} wide />}
        </div>
      )}
      {err && <div className="dg-err">{err}</div>}
      {/* Một job bị ngắt cần trả lời được "vì sao", không chỉ "đã ngắt". `why` giải thích rằng CLI
          bị kill nên không có mã thoát; `trace` là mấy dòng cuối agent kịp phát — thứ trước đây
          mất hẳn cùng tiến trình. */}
      {job?.status === "error" && job?.error?.message && (
        <div className="dg-err">
          <div>{job.error.message}</div>
          {job.error.why && <div className="dg-errwhy">{job.error.why}</div>}
          {job.error.lastActivity &&
            <div className="dg-errwhy">Dòng cuối agent kịp phát: <b>{job.error.lastActivity}</b></div>}
          {job.error.trace?.length > 0 && (
            <details className="dg-errtrace">
              <summary>{job.error.trace.length} dòng cuối trước khi ngắt</summary>
              {job.error.trace.map((e, i) => (
                <div key={i}><span className="dg-dim">{e.kind}</span>{e.session ? ` · ${e.session}` : ""} — {e.text}</div>
              ))}
            </details>
          )}
          <div className="dg-row" style={{ marginTop: 6 }}>
            <button className="mini" onClick={() => setTab("console")}>→ Mở Console xem đầy đủ</button>
            <button className="mini" onClick={() => window.open(`/api/doc-jobs/${jobId}/log/download`, "_blank")}>
              ⬇ Tải log
            </button>
          </div>
        </div>
      )}
      {python && !python.ok && (
        <div className="dg-note warn">⚠ {python.hint} Phần viết nội dung, sửa tay và theo dõi tiến độ
          vẫn chạy bình thường; chỉ nút xuất bị khoá.</div>
      )}

      {tab === "console" ? (
        <RunConsole jobId={jobId} variant="tab" live={writing} />
      ) : tab === "export" ? (
        <ExportTab job={job} plan={plan} perDoc={perDoc} exports={exports} metrics={metrics}
          python={python} onOpen={() => setDialog({ kind: "export" })} onReveal={reveal} onCopy={copyPath} />
      ) : view === "matrix" ? (
        <Matrix plan={plan} onPick={(id) => { setSelected(id); setView("detail"); }} />
      ) : (
        <div className="dg-prog">
          <section className="dg-card dg-treecard">
            <div className="dg-counts">
              <span className="dg-label">Kế hoạch</span>
              <span className="pill acc"><b className="num">{metrics?.done}</b>/{metrics?.sections} mục</span>
              {staleAll.length > 0 && <span className="pill run">{staleAll.length} đã cũ</span>}
              {job?.editedCount > 0 && <span className="pill acc">{job.editedCount} sửa tay</span>}
            </div>
            <div className="dg-tree">
              {(plan.docs || []).map((doc) => (
                <React.Fragment key={doc.key}>
                  <div className="dg-tr l1">
                    <span className="nm">📘 {doc.file}</span>
                    <span className="src"><em className="none">
                      {(perDoc.find((d) => d.key === doc.key)?.done) || 0}/{(doc.sections || []).filter((s) => s.enabled !== false).length} mục
                    </em></span>
                  </div>
                  {(doc.sections || []).map((s) => {
                    const st = ST[s.status] || ST.pending;
                    const on = current?.id === s.id;
                    return (
                      <button key={s.id} className={`dg-str l${levelOf(s.num)} ${st.cls}${on ? " on" : ""}`}
                        onClick={() => setSelected(s.id)}>
                        <i className="ic" title={st.label}>{st.ic}</i>
                        <b className="no">{s.num}.</b>
                        <abbr className="tt" title={s.hint}>{s.title}</abbr>
                        {s.edited && <span className="pill acc">✎</span>}
                        {ir[`${doc.key}/${s.num}`] && <span className="dg-dim num">{s.words || 0} từ</span>}
                      </button>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          </section>

          <section className="dg-card dg-readcard">
            <div className="dg-counts">
              <span className="dg-label">{live ? "Đang viết" : "Nội dung"}</span>
              {current && <span className="pill">{current.docFile}</span>}
              <span className="dg-spacer" />
              {current && (
                <>
                  {current.edited ? (
                    <button className="mini" onClick={() => setDialog({ kind: "unedit", section: current })}
                      title="Cho agent quyền viết lại mục này">↺ Bỏ đánh dấu đã sửa tay</button>
                  ) : null}
                  <button className="mini" onClick={() => setDialog({ kind: "edit" })}
                    title="Sửa tay nội dung mục này">✎ Sửa</button>
                  {!current.edited && (
                    <button className="mini" title="Chỉ viết lại đúng mục này"
                      onClick={() => startWrite([current.id])}>▶ Viết lại mục này</button>
                  )}
                </>
              )}
            </div>
            <div className="dg-read">
              <IrView ir={currentIr} section={current} />
              {current?.status === "error" && current?.error &&
                <div className="dg-err">{current.error}</div>}
            </div>
            {/* Khung Hoạt động cũ là 9 dòng rút gọn giữ trong RAM trình duyệt. Giờ nó là console
                thu nhỏ: cùng nguồn dữ liệu với tab Console, mở được từng dòng, phình ra toàn màn
                hình bằng ⛶, và tải log về được ngay tại đây. */}
            <RunConsole jobId={jobId} variant="inline" live={writing} />
          </section>

          <aside className="dg-side">
            <div className="dg-card">
              <div className="dg-label mb">Thống kê</div>
              <div className="dg-stat big"><span>Tiến độ</span><b>{pct}%</b></div>
              <div className="bar"><i style={{ width: pct + "%", background: job?.status === "writing" ? "var(--running)" : "var(--done)" }} /></div>
              <div className="dg-stat"><span>Mục</span><b>{metrics?.done} / {metrics?.sections}</b></div>
              <div className="dg-stat"><span>Nội dung</span><b>~{metrics?.pages || 0} trang</b></div>
              <div className="dg-stat sub"><span>{metrics?.tables || 0} bảng · {metrics?.figures || 0} hình</span></div>
              <div className="dg-stat"><span>Đã chạy</span><b>{mmss(job?.metrics?.elapsedMs)}</b></div>
              <div className="dg-stat"><span>Token</span><b>{fmtTokens(job?.metrics?.tokens || 0)}</b></div>
              <p className="dg-note">Số trang là ước tính từ nội dung, không phải kết quả dựng thật.</p>
            </div>

            <div className="dg-card">
              <div className="dg-label mb">Nguồn của nội dung</div>
              <div className="dg-stat"><span>Khối có nguồn</span><b>{metrics?.sourced || 0}</b></div>
              <div className="dg-stat"><span>Khối chưa có nguồn</span>
                <b className={metrics?.unsourced ? "bad" : ""}>{metrics?.unsourced || 0}</b></div>
              <p className="dg-note">Mọi khẳng định phải dẫn được về tệp nguồn. Khối không có nguồn phải
                tự khai <b>assumption</b> hoặc do chủ sản phẩm cung cấp.</p>
            </div>

            <div className="dg-card">
              <div className="dg-label mb">Chú giải trạng thái</div>
              {["written", "writing", "pending", "edited", "stale", "error", "skipped"].map((k) => (
                <div className="dg-leg" key={k}>
                  <i className={ST[k].cls}>{ST[k].ic}</i><span>{ST[k].label}</span>
                </div>
              ))}
            </div>
          </aside>
        </div>
      )}

      <EconomyDialog open={eco.dialogOpen} economy={eco.economy}
        onCancel={eco.closeDialog} onSave={eco.save} />

      <SectionEditor open={dialog?.kind === "edit"} section={current} ir={currentIr}
        onCancel={() => setDialog(null)} onSave={saveEdit} />

      <ExportDialog open={dialog?.kind === "export"} job={job} plan={plan} perDoc={perDoc}
        python={python} onCancel={() => setDialog(null)} onExport={runExport} />

      <Dialog open={dialog?.kind === "unedit"} title="Bỏ đánh dấu “đã sửa tay”?"
        onClose={() => setDialog(null)}
        footer={<DialogButtons onCancel={() => setDialog(null)} onOk={unedit} danger
          okLabel="↺ Bỏ đánh dấu" />}>
        <p>Mục <b className="hl">{dialog?.section?.num}. {dialog?.section?.title}</b> đang được bảo vệ:
          agent không ghi đè nó.</p>
        <p>Bỏ đánh dấu xong, <b className="hl">lần viết tới sẽ ghi đè toàn bộ nội dung bạn sửa tay</b> ở
          mục này và không có cách hoàn lại. Muốn giữ lại thì bấm Huỷ.</p>
      </Dialog>

      <TokenConfirm open={!!ask} kind={ask || "write"} settings={settings}
        tokens={ask === "rewrite" ? staleTokens : pendingTokens}
        account={est?.account} usage={est?.usage} spent={job?.metrics?.tokens || 0}
        onSettings={onSettings} onCancel={() => setAsk(null)}
        onConfirm={(dontAsk) => {
          const kind = ask; setAsk(null);
          if (dontAsk) onSettings({ dontAsk: { ...(settings?.dontAsk || {}), [kind]: true } });
          startWrite(kind === "rewrite" ? staleBulk.map((s) => s.id) : null);
        }} />
    </div>
  );
}

// Ma trận: documents down, section numbers across, full width, % last. An empty cell means "chờ";
// a cell with no background at all means "chuẩn không có mục này" — the legend spells that out
// because the difference is the whole point of the view.
function Matrix({ plan, onPick }) {
  const cols = useMemo(() => {
    const set = new Set();
    for (const d of plan?.docs || []) for (const s of d.sections || []) set.add(String(s.num));
    return [...set].sort(numCmp);
  }, [plan]);
  const dense = cols.length > 22;

  return (
    <section className="dg-card">
      <div className="dg-scroll">
        <table className={"dg-hm" + (dense ? " dense" : "")}>
          <thead>
            <tr>
              <th className="rowh">Tài liệu</th>
              {cols.map((c) => <th key={c} title={"Mục " + c}>{c}</th>)}
              <th className="pct">%</th>
            </tr>
          </thead>
          <tbody>
            {(plan?.docs || []).map((d) => {
              const by = new Map((d.sections || []).map((s) => [String(s.num), s]));
              const on = (d.sections || []).filter((s) => s.enabled !== false && s.status !== "skipped");
              const done = on.filter((s) => ["written", "edited", "stale"].includes(s.status)).length;
              const pct = on.length ? Math.round((done / on.length) * 100) : 0;
              return (
                <tr key={d.key}>
                  <th className="rowh" title={d.file}>{d.title}</th>
                  {cols.map((c) => {
                    const s = by.get(c);
                    if (!s) return <td className="x" key={c} title="Chuẩn không có mục này" />;
                    const st = ST[s.status] || ST.pending;
                    return (
                      <td key={c} className={st.cls} title={`${s.num}. ${s.title} — ${st.label}`}
                        onClick={() => onPick(s.id)}>{dense ? "" : st.ic}</td>
                    );
                  })}
                  <td className="pctv" style={{ color: pct === 100 ? "var(--done)" : pct ? "var(--running)" : "var(--muted)" }}>
                    {pct}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="dg-legend">
        {["written", "writing", "pending", "edited", "stale", "error"].map((k) => (
          <span key={k}><i className={ST[k].cls} />{ST[k].label}</span>
        ))}
        <span><i className="x" />chuẩn không có mục này</span>
      </div>
      <p className="dg-note">Bấm một ô để mở nội dung mục đó ở kiểu xem Chi tiết.</p>
    </section>
  );
}

// MH 7 — what is in the Studio, and what has already been written out to disk.
// Hai nút đi liền nhau, không bao giờ tách: **mở** thư mục và **chép** đường dẫn.
//
// "Mở" là việc của server, và nó có hai giới hạn không sửa được từ đây (chú thích dài ở
// `server/docgen/dests.js`): cửa sổ mở ra nằm sau trình duyệt, và nó mở trên máy chạy server chứ
// không phải máy đang xem. Cả hai đều biến "thành công" thành "bấm chẳng thấy gì".
//
// "Chép" thì luôn đúng, ở mọi trường hợp, kể cả khi Studio đang mở từ một máy khác. Vì vậy nó là
// đường lùi mặc định, không phải thứ chỉ hiện ra sau khi mở thất bại — lúc mở "thành công" mà người
// dùng không thấy gì mới đúng là lúc cần nó nhất.
function PathActions({ path, onReveal, onCopy, wide }) {
  if (!path) return null;
  return (
    <span className="dg-pathbtns" style={wide ? { marginLeft: 8 } : undefined}>
      <button className="mini" title={"Mở thư mục trên máy chạy server\n" + path}
        onClick={() => onReveal?.(path)}>📂{wide ? " Mở thư mục" : ""}</button>
      <button className="mini" title={"Chép đường dẫn\n" + path}
        onClick={() => onCopy?.(path)}>📋{wide ? " Chép đường dẫn" : ""}</button>
    </span>
  );
}

function ExportTab({ job, plan, perDoc, exports, metrics, python, onOpen, onReveal, onCopy }) {
  const doneOf = new Map((perDoc || []).map((d) => [d.key, d]));
  const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");
  const when = (t) => new Date(t).toLocaleString("vi-VN",
    { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="dg-pane">
      {metrics?.done < metrics?.sections && (
        <div className="dg-note">Bộ này còn <b>{metrics.sections - metrics.done} mục chưa viết</b>. Xuất
          vẫn được — những mục chưa có nội dung sẽ hiện dòng “Mục này chưa có nội dung” trong tệp, và
          nên bật đóng dấu <b>BẢN NHÁP</b>.</div>
      )}

      <div className="dg-label">Nội dung trong Studio</div>
      {(plan?.docs || []).map((d) => {
        const st = doneOf.get(d.key) || { done: 0, sections: 0, pages: 0 };
        return (
          <div className="dg-art" key={d.key}>
            <span>📘</span>
            <div className="nm">{d.file}
              <em>{st.sections} mục · ~{st.pages || 0} trang · đã viết {st.done}/{st.sections}</em></div>
            {st.done >= st.sections && st.sections > 0
              ? <span className="pill ok">✓ đủ nội dung</span>
              : <span className="pill run">đang viết {st.done}/{st.sections}</span>}
          </div>
        );
      })}

      <div className="dg-row" style={{ marginTop: 4 }}>
        <button className="primary" onClick={onOpen} disabled={python && !python.ok}>⬇ Xuất…</button>
        {python?.ok && <span className="dg-sub">Python {python.python} · python-docx {python.pythonDocx}</span>}
      </div>

      <div className="dg-label" style={{ marginTop: 8 }}>Đã xuất ra máy</div>
      {!exports.length ? (
        <p className="dg-muted">Chưa xuất lần nào.</p>
      ) : exports.map((x) => (
        <React.Fragment key={x.id}>
          {(x.files || []).map((f) => (
            <div className="dg-art" key={f.path}>
              <span>📄</span>
              <div className="nm">{f.path.split(/[\\/]/).pop()}
                <em title={f.path}>{x.destDir} · {kb(f.bytes)} · {when(x.at)}</em></div>
              <span className="pill">Word</span>
              {x.draft && <span className="pill run">bản nháp</span>}
              {/* Mở thư mục, không mở tệp: mở .docx là chạy Word, đó không phải việc của nút này. */}
              <PathActions path={x.destDir} onReveal={onReveal} onCopy={onCopy} />
            </div>
          ))}
          {(x.skipped || []).map((s) => (
            <div className="dg-art" key={s.path}>
              <span>⚠</span>
              <div className="nm">{s.path.split(/[\\/]/).pop()}<em>{s.reason}</em></div>
              <span className="pill err">bỏ qua</span>
            </div>
          ))}
          {(x.warnings || []).map((w, i) => <div className="dg-note warn" key={i}>⚠ {w}</div>)}
        </React.Fragment>
      ))}
    </div>
  );
}
