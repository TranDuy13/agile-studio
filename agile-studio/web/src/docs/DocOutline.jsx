import React, { useCallback, useEffect, useRef, useState } from "react";
import TokenConfirm, { TokenChip, fmtTokens, shouldAsk } from "./TokenConfirm.jsx";
import Dialog, { DialogButtons, Field } from "./Dialog.jsx";

// The approval gate (MH 3): the agent proposes, the user edits, and only then is the outline
// frozen. Nothing downstream has a stable denominator until this screen is done (Q8).
//
// Layout: the outline is the subject of the screen, so it gets the width. The right rail carries
// only what you decide with — forecast, engine, the approve button — and sticks to the viewport
// so the primary action never scrolls away. Survey findings are a wide grid UNDER both columns:
// ten sentences squeezed into a 300px rail wrap into forty lines and leave the page lopsided.

const ENGINES = [
  { id: "per-doc", label: "Song song theo tài liệu", sub: "Nhanh · tạm dừng, đổi account được" },
  { id: "single", label: "Tuần tự một phiên", sub: "Nhất quán thuật ngữ cao nhất · chậm hơn" },
  { id: "per-section", label: "Song song theo mục", sub: "Nhanh nhất · tốn token nhất" },
];

const KINDS = [
  { id: "reference", label: "reference — tra cứu, súc tích" },
  { id: "howto", label: "howto — các bước làm" },
  { id: "explanation", label: "explanation — giải thích vì sao" },
  { id: "tutorial", label: "tutorial — dắt đi một lượt" },
];

const levelOf = (num) => Math.min(3, String(num).split(".").length + 1); // doc row is level 1
const hhmm = (t) => new Date(t).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit",
  day: "2-digit", month: "2-digit" });

// A full path in a narrow column truncates to nothing readable. The tail is the informative part,
// so show the last two segments and keep the whole thing in the tooltip.
function shortSource(p) {
  const s = String(p || "").replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = s.split("/").filter(Boolean);
  return parts.length <= 2 ? s : "…/" + parts.slice(-2).join("/");
}

export default function DocOutline({ jobId, settings, onSettings, onBack, onJobChanged }) {
  const [job, setJob] = useState(null);
  const [plan, setPlan] = useState(null);
  const [stats, setStats] = useState(null);
  const [est, setEst] = useState(null);
  const [presets, setPresets] = useState([]);
  const [revise, setRevise] = useState("");
  const [engine, setEngine] = useState("per-doc");
  const [editing, setEditing] = useState(null);   // section id being renamed
  const [drag, setDrag] = useState(null);         // { docKey, index }
  const [over, setOver] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  const [ask, setAsk] = useState(null);           // token dialog: "revise"
  const [dialog, setDialog] = useState(null);     // { kind, ...state }
  const [showFacts, setShowFacts] = useState(true);
  const planRef = useRef(null);

  const load = useCallback(() => {
    fetch(`/api/doc-jobs/${jobId}`).then((r) => r.json()).then((d) => {
      if (d.error) return setErr(d.error);
      setJob(d.job); setPlan(d.plan); planRef.current = d.plan;
      setEngine(d.plan?.engine || d.job?.run?.engine || "per-doc");
    }).catch((e) => setErr(String(e.message)));
    fetch(`/api/doc-jobs/${jobId}/plan`).then((r) => r.json()).then((d) => setStats(d.stats)).catch(() => {});
    fetch(`/api/doc-jobs/${jobId}/estimate?usage=1`).then((r) => r.json()).then(setEst).catch(() => {});
    fetch("/api/doc-presets").then((r) => r.json()).then((d) => setPresets(d.presets || [])).catch(() => {});
  }, [jobId]);
  useEffect(load, [load]);

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(""), 5000); };
  const approved = !!plan?.approvedAt;
  const locked = approved;   // a frozen outline is read-only until explicitly unlocked

  // Any structural edit goes straight to the server, which returns the recomputed forecast —
  // that is what makes the estimate move the moment a section is switched off (test case 6).
  const save = async (next) => {
    setPlan(next); planRef.current = next;
    const r = await fetch(`/api/doc-jobs/${jobId}/plan`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan: next }),
    }).then((x) => x.json()).catch((e) => ({ error: String(e.message) }));
    if (r.error) { setErr(r.error); return; }
    setStats(r.stats); setErr("");
  };

  const mutate = (fn) => {
    const next = JSON.parse(JSON.stringify(planRef.current));
    fn(next);
    save(next);
  };
  const mutateDoc = (docKey, fn) => mutate((next) => {
    const doc = next.docs.find((d) => d.key === docKey);
    if (doc) fn(doc, next);
  });

  const toggleSection = (docKey, id) =>
    mutateDoc(docKey, (doc) => {
      const s = doc.sections.find((x) => x.id === id);
      if (s) { s.enabled = s.enabled === false; s.userEnabled = s.enabled; }
    });

  // Bulk selection: picking 25 checkboxes by hand is the kind of work a toolbar should do.
  const bulk = (mode) => mutate((next) => {
    for (const doc of next.docs) for (const s of doc.sections) {
      const on = mode === "all" ? true
        : mode === "none" ? false
        : mode === "required" ? !!s.required
        : mode === "agent" ? (s.origin === "agent" || !!s.required)
        : s.enabled !== false;
      s.enabled = on; s.userEnabled = on;
    }
  });

  const renameSection = (docKey, id, title) =>
    mutateDoc(docKey, (doc) => {
      const s = doc.sections.find((x) => x.id === id);
      if (s && title.trim()) { s.title = title.trim(); s.userTitle = true; }
    });

  const removeSection = (docKey, id) =>
    mutateDoc(docKey, (doc) => { doc.sections = doc.sections.filter((s) => s.id !== id); });

  const addSection = ({ docKey, title, kind, afterId }) => {
    mutateDoc(docKey, (doc) => {
      const at = doc.sections.findIndex((s) => s.id === afterId);
      const parent = at >= 0 ? doc.sections[at] : null;
      // Insert under the section it follows so the numbering stays inside the standard's scheme.
      const base = parent ? String(parent.num).split(".")[0] : String(doc.sections.length + 1);
      let num = parent ? `${base}.1` : base;
      for (let i = 1; doc.sections.some((s) => String(s.num) === num); i++) num = `${base}.${i}`;
      doc.sections.splice(at >= 0 ? at + 1 : doc.sections.length, 0, {
        id: `${docKey}/u${Date.now().toString(36)}`, num, title: title.trim(), kind,
        required: false, hint: "Mục do người dùng thêm",
        accept: { minBlocks: 1, minSources: 1 }, from: [], sources: [],
        origin: "user", enabled: true, userEnabled: true, status: "pending", words: 0,
      });
    });
    flash(`Đã thêm mục “${title.trim()}”.`);
  };

  const onDrop = (docKey, index) => {
    if (!drag || drag.docKey !== docKey) { setDrag(null); setOver(null); return; }
    mutateDoc(docKey, (doc) => {
      const [moved] = doc.sections.splice(drag.index, 1);
      doc.sections.splice(index, 0, moved);
    });
    setDrag(null); setOver(null);
  };

  const runRevise = async () => {
    setBusy("revise"); setErr("");
    const r = await fetch(`/api/doc-jobs/${jobId}/plan/revise`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: revise }),
    }).then((x) => x.json()).catch((e) => ({ error: String(e.message) }));
    setBusy("");
    if (r.error) setErr(r.error);
    else { setRevise(""); flash("Đã gửi yêu cầu — agent đang đề xuất lại dàn ý."); onJobChanged?.(); }
  };

  const approve = async () => {
    setBusy("approve"); setErr(""); setDialog(null);
    const r = await fetch(`/api/doc-jobs/${jobId}/plan/approve`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ engine }),
    }).then((x) => x.json()).catch((e) => ({ error: String(e.message) }));
    setBusy("");
    if (r.error) return setErr(r.error);
    setPlan(r.plan); planRef.current = r.plan; setStats(r.stats); setJob(r.job);
    flash(`Đã chốt dàn ý — ${r.stats.sections} mục là mẫu số cho mọi con số tiến độ về sau.`);
    onJobChanged?.();
  };

  const unlock = async () => {
    setDialog(null); setBusy("unlock");
    const r = await fetch(`/api/doc-jobs/${jobId}/plan/unlock`, { method: "POST" })
      .then((x) => x.json()).catch((e) => ({ error: String(e.message) }));
    setBusy("");
    if (r.error) return setErr(r.error);
    setPlan(r.plan); planRef.current = r.plan; setStats(r.stats); setJob(r.job);
    flash("Đã mở khoá — sửa xong nhớ duyệt lại.");
    onJobChanged?.();
  };

  const savePreset = async (name) => {
    setDialog(null);
    const r = await fetch(`/api/doc-jobs/${jobId}/plan/save-preset`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
    }).then((x) => x.json());
    if (r.error) setErr(r.error);
    else { setPresets((s) => [r.preset, ...s.filter((p) => p.id !== r.preset.id)]); flash(`Đã lưu preset “${r.preset.name}”.`); }
  };

  const applyPreset = async (presetId) => {
    if (!presetId) return;
    const r = await fetch(`/api/doc-jobs/${jobId}/plan/apply-preset`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ presetId }),
    }).then((x) => x.json());
    if (r.error) setErr(r.error);
    else { setPlan(r.plan); planRef.current = r.plan; setStats(r.stats); flash("Đã áp preset — sửa lại thoải mái rồi duyệt."); }
  };

  if (err && !plan) return <div className="dg-pane"><div className="dg-err">{err}</div>
    <button className="ghost" onClick={onBack}>← Quay lại</button></div>;

  // A job whose survey has not run yet (or failed) still has a screen: applying a preset builds
  // an outline without spending a token.
  if (!plan) return (
    <div className="dg-pane">
      <div className="dg-head">
        <button className="mini" onClick={onBack}>← Danh sách</button>
        <b className="dg-h1">{job?.name || "Đang tải…"}</b>
        {job && <span className="pill acc">{job.standardLabel}</span>}
      </div>
      {job && (
        <div className="dg-card dg-empty">
          <p className="dg-muted">Chưa có dàn ý. Cho agent khảo sát mã nguồn để đề xuất, hoặc áp một preset
            đã lưu (không tốn token).</p>
          <div className="dg-row">
            <button className="primary" onClick={() => fetch(`/api/doc-jobs/${jobId}/survey`, { method: "POST" })
              .then((r) => r.json()).then((d) => (d.error ? setErr(d.error) : onBack()))}>
              Khảo sát & đề xuất dàn ý <TokenChip tokens={est?.survey || 0} threshold={settings?.tokenThreshold} />
            </button>
            <select className="dg-inp" value="" onChange={(e) => { applyPreset(e.target.value); e.target.value = ""; }}>
              <option value="">Áp preset…</option>
              {presets.filter((p) => p.standardId === job.standardId)
                .map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          {err && <div className="dg-err">{err}</div>}
        </div>
      )}
    </div>
  );

  const writeTokens = stats?.estTokens || 0;
  const windows = writeTokens / (settings?.tokensPer5h || 2000000);
  const leftPct = est?.usage?.fiveHourPct != null ? Math.max(0, 100 - Math.round(est.usage.fiveHourPct)) : null;
  const all = plan.docs.flatMap((d) => d.sections);
  const count = {
    on: all.filter((s) => s.enabled !== false).length,
    off: all.filter((s) => s.enabled === false).length,
    required: all.filter((s) => s.required).length,
    agent: all.filter((s) => s.origin === "agent").length,
    user: all.filter((s) => s.origin === "user").length,
    total: all.length,
  };
  const optionalOn = all.filter((s) => !s.required && s.enabled !== false).length;
  const overBudget = leftPct != null && windows * 100 > leftPct;
  const facts = job?.facts?.items || [];

  return (
    <div className="dg-pane">
      <div className="dg-head">
        <button className="mini" onClick={onBack}>← Danh sách</button>
        <b className="dg-h1">{job?.name}</b>
        <span className="pill acc">{job?.standardLabel}</span>
        {approved
          ? <span className="pill ok">✓ dàn ý đã chốt</span>
          : <span className="pill acc">⏸ chờ duyệt dàn ý</span>}
        <span className="dg-spacer" />
        <span className="dg-sub">
          {job?.survey?.elapsedMs ? `khảo sát ${Math.round(job.survey.elapsedMs / 1000)}s · ` : ""}
          {job?.survey?.tokens ? `${fmtTokens(job.survey.tokens)} tok · ` : ""}
          bản sửa {plan.revision}
        </span>
      </div>

      {toast && <div className="dg-toast">✅ {toast}</div>}
      {err && <div className="dg-err">{err}</div>}
      {job?.survey?.warning && <div className="dg-note">⚠ Phiên khảo sát thoát bất thường nhưng vẫn ghi được
        kết quả nên dàn ý dưới đây là hợp lệ. Lý do CLI báo: {job.survey.warning}</div>}

      {approved && (
        <div className="dg-banner">
          <div className="dg-banner-t">
            <b>✓ Dàn ý đã đóng băng lúc {hhmm(plan.approvedAt)}</b>
            <span>{count.on} mục là mẫu số cho mọi con số tiến độ về sau
              {count.off ? ` · ${count.off} mục bỏ qua` : ""} · {ENGINES.find((e) => e.id === (plan.engine || engine))?.label}</span>
          </div>
          <div className="dg-banner-acts">
            <button className="ghost" onClick={onBack}>← Về danh sách</button>
            <button className="primary" disabled title="Viết nội dung là feature kế tiếp (D2)">▶ Bắt đầu viết</button>
          </div>
        </div>
      )}

      <div className="dg-outline">
        <section className="dg-card dg-treecard">
          <header className="dg-toolbar">
            <div className="dg-toolgrp">
              <span className="dg-label">Chọn nhanh</span>
              <button className="mini" disabled={locked} onClick={() => bulk("all")}>Tất cả</button>
              <button className="mini" disabled={locked} onClick={() => bulk("none")}>Bỏ tất cả</button>
              <button className="mini" disabled={locked} onClick={() => bulk("required")}
                title="Chỉ giữ các mục chuẩn bắt buộc">Chỉ bắt buộc</button>
              <button className="mini" disabled={locked} onClick={() => bulk("agent")}
                title="Giữ mục bắt buộc và mục agent đề xuất thêm">+ agent đề xuất</button>
            </div>
            <div className="dg-toolgrp dg-toolgrp-r">
              <button className="mini" disabled={locked} onClick={() => setDialog({ kind: "add" })}>＋ Thêm mục</button>
              <button className="mini" disabled={locked} onClick={() => setDialog({ kind: "preset" })}>Áp preset…</button>
              <button className="mini" onClick={() => setDialog({ kind: "savePreset" })}>💾 Lưu thành preset</button>
            </div>
          </header>

          <div className="dg-counts">
            <span className="pill acc"><b className="num">{count.on}</b>/{count.total} mục bật</span>
            <span className="pill">{count.required} bắt buộc</span>
            {count.agent > 0 && <span className="pill">{count.agent} agent đề xuất</span>}
            {count.user > 0 && <span className="pill">{count.user} tự thêm</span>}
            {count.off > 0 && <span className="pill err">{count.off} bỏ qua</span>}
            <span className="dg-spacer" />
            <span className="dg-sub">Bấm đúp tên mục để đổi tên · kéo ⠿ để đổi thứ tự</span>
          </div>

          <div className="dg-tree">
            {plan.docs.map((doc) => (
              <React.Fragment key={doc.key}>
                <div className="dg-tr l1">
                  <span className="nm">📘 {doc.file}</span>
                  <span className="src">{doc.sections.filter((s) => s.enabled !== false).length}/{doc.sections.length} mục</span>
                </div>
                {doc.sections.map((s, i) => (
                  <div key={s.id}
                    className={"dg-tr l" + levelOf(s.num)
                      + (s.enabled === false ? " off" : "") + (s.proposedDrop ? " drop" : "")
                      + (s.origin === "agent" ? " added" : "")
                      + (over && over.docKey === doc.key && over.index === i ? " dragover" : "")}
                    draggable={!locked && !editing}
                    onDragStart={() => setDrag({ docKey: doc.key, index: i })}
                    onDragOver={(e) => { e.preventDefault(); setOver({ docKey: doc.key, index: i }); }}
                    onDragLeave={() => setOver(null)}
                    onDrop={(e) => { e.preventDefault(); onDrop(doc.key, i); }}>
                    <span className="grip" title="Kéo để đổi thứ tự">⠿</span>
                    <button className="tgl" disabled={locked} aria-pressed={s.enabled !== false}
                      title={s.enabled === false ? "Bật mục này" : "Tắt mục này"}
                      onClick={() => toggleSection(doc.key, s.id)}>{s.enabled === false ? "☐" : "☑"}</button>
                    {editing === s.id ? (
                      <input className="rename" autoFocus defaultValue={s.title}
                        onBlur={(e) => { renameSection(doc.key, s.id, e.target.value); setEditing(null); }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                          if (e.key === "Escape") setEditing(null);
                        }} />
                    ) : (
                      <span className="nm" onDoubleClick={() => !locked && setEditing(s.id)}
                        title="Bấm đúp để đổi tên">
                        <b className="no">{s.num}.</b>
                        <abbr className="tt" title={s.hint}>{s.title}</abbr>
                        {s.origin === "agent" && <span className="pill acc">agent</span>}
                        {s.origin === "user" && <span className="pill acc">tự thêm</span>}
                        {s.required && <span className="pill">bắt buộc</span>}
                        {s.proposedDrop && s.enabled !== false &&
                          <span className="pill err" title={s.note}>agent đề xuất bỏ</span>}
                      </span>
                    )}
                    <span className="src" title={(s.sources || []).join("\n") || s.note}>
                      {s.sources?.length
                        ? <>
                            {s.sources.slice(0, 2).map((p) => <em key={p}>{shortSource(p)}</em>)}
                            {s.sources.length > 2 && <em className="more">+{s.sources.length - 2}</em>}
                          </>
                        : <em className="none">{s.note ? "agent đề xuất bỏ" : "chưa gắn nguồn"}</em>}
                    </span>
                    {s.origin === "user" && !locked &&
                      <button className="mini danger x" title="Xoá mục này"
                        onClick={() => removeSection(doc.key, s.id)}>✕</button>}
                  </div>
                ))}
              </React.Fragment>
            ))}
          </div>
        </section>

        <aside className="dg-side">
          <div className="dg-card">
            <div className="dg-label mb">Dự báo chi phí</div>
            <div className="dg-stat big"><span>Viết cả bộ</span><b>~{fmtTokens(writeTokens)}</b></div>
            <div className="dg-stat"><span>Quy đổi</span><b>≈ {windows.toFixed(windows < 1 ? 2 : 1)} cửa sổ 5h</b></div>
            <div className="dg-stat">
              <span>Account</span>
              <b>{est?.account?.label || est?.account?.id || "—"}{leftPct != null ? ` · còn ${leftPct}%` : ""}</b>
            </div>
            {overBudget && (
              <div className="dg-note warn">Vượt quota còn lại của account đang chọn — tắt bớt {optionalOn} mục
                không bắt buộc, hoặc đổi account.</div>
            )}
            <p className="dg-note">Ước tính có sai số lớn. Đây là chi phí của <b>bước viết</b> sau này —
              chốt dàn ý không tiêu token nào.</p>
          </div>

          <div className="dg-card">
            <div className="dg-label mb">Cách chạy <span className="dg-dim">· đổi được giữa chừng</span></div>
            {ENGINES.map((e) => (
              <button key={e.id} className={"dg-chk" + (engine === e.id ? " on" : "")}
                disabled={locked} onClick={() => setEngine(e.id)}>
                <i className="bx radio">{engine === e.id ? "●" : ""}</i>
                <span className="dg-chk-t"><b>{e.label}</b><span>{e.sub}</span></span>
              </button>
            ))}
          </div>

          {!approved ? (
            <div className="dg-card dg-actions">
              <div className="dg-field">
                <span className="dg-label">Yêu cầu agent sửa dàn ý</span>
                <textarea className="dg-inp" rows={2} value={revise}
                  placeholder="vd: Gộp 6.1 vào mục 8. Tách job nền thành từng job một."
                  onChange={(e) => setRevise(e.target.value)} />
              </div>
              <button className="ghost" disabled={!revise.trim() || busy === "revise"}
                onClick={() => (shouldAsk("revise", est?.revise || 0, settings) ? setAsk("revise") : runRevise())}>
                {busy === "revise" ? "Đang gửi…" : "↻ Đề xuất lại dàn ý"}{" "}
                <TokenChip tokens={est?.revise || 0} threshold={settings?.tokenThreshold} />
              </button>
              <button className="primary big" disabled={busy === "approve" || !count.on}
                onClick={() => setDialog({ kind: "approve" })}>
                {busy === "approve" ? "Đang chốt…" : `✔ Duyệt & chốt ${count.on} mục`}
              </button>
              <p className="dg-note">Chốt xong màn này chuyển sang chỉ đọc; cần sửa thì mở khoá lại được.</p>
            </div>
          ) : (
            <div className="dg-card dg-actions">
              <button className="ghost" disabled={busy === "unlock"} onClick={() => setDialog({ kind: "unlock" })}>
                🔓 Mở khoá để sửa dàn ý
              </button>
            </div>
          )}
        </aside>
      </div>

      {facts.length > 0 && (
        <section className="dg-card">
          <button className="dg-collapse" onClick={() => setShowFacts((v) => !v)}>
            <span className="dg-label">Agent phát hiện khi khảo sát</span>
            <span className="pill">{facts.length}</span>
            <span className="dg-spacer" />
            <span className="dg-dim">{showFacts ? "▾ thu gọn" : "▸ mở"}</span>
          </button>
          {showFacts && (
            <div className="dg-facts">
              {facts.map((f, i) => (
                <div className={"dg-fact" + (f.level === "warn" ? " warn" : "")} key={i}>
                  <i>{f.level === "warn" ? "!" : "✓"}</i><span>{f.text}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <AddSectionDialog open={dialog?.kind === "add"} plan={plan}
        onCancel={() => setDialog(null)} onOk={(v) => { setDialog(null); addSection(v); }} />

      <SavePresetDialog open={dialog?.kind === "savePreset"} defaultName={`${job?.name} — dàn ý`}
        sections={count.on} onCancel={() => setDialog(null)} onOk={savePreset} />

      <ApplyPresetDialog open={dialog?.kind === "preset"} presets={presets.filter((p) => p.standardId === job?.standardId)}
        onCancel={() => setDialog(null)} onOk={(id) => { setDialog(null); applyPreset(id); }} />

      <Dialog open={dialog?.kind === "approve"} title="Chốt dàn ý này?" onClose={() => setDialog(null)}
        footer={<DialogButtons onCancel={() => setDialog(null)} onOk={approve} okLabel="✔ Chốt dàn ý" />}>
        <div className="dg-card" style={{ padding: "9px 11px" }}>
          <div className="dg-stat"><span>Bộ tài liệu</span><b>{stats?.docs} tài liệu · {count.on} mục bật</b></div>
          {count.off > 0 && <div className="dg-stat"><span>Bỏ qua</span><b>{count.off} mục</b></div>}
          <div className="dg-stat"><span>Cách chạy</span><b>{ENGINES.find((e) => e.id === engine)?.label}</b></div>
        </div>
        <p>Sau khi chốt, <b className="hl">{count.on} mục</b> là mẫu số cho mọi con số tiến độ về sau.
          Màn này chuyển sang chỉ đọc; cần sửa thì mở khoá lại được.</p>
        <p>⛽ <b className="hl">~{fmtTokens(writeTokens)} token</b> là chi phí ước tính của <b className="hl">bước
          viết nội dung</b> sau này — chốt dàn ý không tiêu token nào.</p>
      </Dialog>

      <Dialog open={dialog?.kind === "unlock"} title="Mở khoá dàn ý?" onClose={() => setDialog(null)}
        footer={<DialogButtons onCancel={() => setDialog(null)} onOk={unlock} okLabel="🔓 Mở khoá" danger />}>
        <p>Dàn ý đang là <b className="hl">mẫu số của tiến độ</b>. Mở khoá rồi thêm hoặc bớt mục sẽ làm mọi
          phần trăm tính lại từ đầu, và các mục đã viết có thể không còn khớp dàn ý mới.</p>
        <p>Muốn giữ nguyên bản đã chốt thì bấm Huỷ, rồi <b className="hl">lưu nó thành preset</b> và tạo một
          bộ tài liệu mới từ preset đó.</p>
      </Dialog>

      <TokenConfirm open={!!ask} kind={ask || "revise"} settings={settings}
        tokens={est?.revise || 0} account={est?.account} usage={est?.usage} spent={job?.metrics?.tokens || 0}
        onSettings={onSettings} onCancel={() => setAsk(null)}
        onConfirm={(dontAsk) => {
          const kind = ask; setAsk(null);
          if (dontAsk) onSettings({ dontAsk: { ...(settings?.dontAsk || {}), [kind]: true } });
          runRevise();
        }} />
    </div>
  );
}

function AddSectionDialog({ open, plan, onCancel, onOk }) {
  const [docKey, setDocKey] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("explanation");
  const [afterId, setAfterId] = useState("");
  useEffect(() => {
    if (!open) return;
    const first = plan?.docs?.[0];
    setDocKey(first?.key || ""); setTitle(""); setKind("explanation");
    setAfterId(first?.sections?.at(-1)?.id || "");
  }, [open, plan]);
  const doc = plan?.docs?.find((d) => d.key === docKey);
  return (
    <Dialog open={open} title="Thêm mục vào dàn ý" width={500} onClose={onCancel}
      sub="Mục tự thêm nằm ngoài chuẩn nên không tính vào tiêu chí “Đầy đủ” khi chấm điểm."
      footer={<DialogButtons onCancel={onCancel} okLabel="＋ Thêm mục" okDisabled={!title.trim() || !docKey}
        onOk={() => onOk({ docKey, title, kind, afterId })} />}>
      {plan?.docs?.length > 1 && (
        <Field label="Thêm vào tài liệu">
          <select className="dg-inp" value={docKey} onChange={(e) => {
            setDocKey(e.target.value);
            setAfterId(plan.docs.find((d) => d.key === e.target.value)?.sections?.at(-1)?.id || "");
          }}>
            {plan.docs.map((d) => <option key={d.key} value={d.key}>{d.file}</option>)}
          </select>
        </Field>
      )}
      <Field label="Tên mục" hint="Tên mục của chuẩn thì giữ nguyên tiếng Anh; mục tự nghĩ ra thì đặt tiếng Việt cũng được.">
        <input className="dg-inp" value={title} placeholder="vd: Appendix — Command Reference"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && title.trim()) onOk({ docKey, title, kind, afterId }); }} />
      </Field>
      <Field label="Loại nội dung (Diátaxis)" hint="Quyết định văn phong khi viết: reference luôn súc tích, howto luôn đánh số bước.">
        <select className="dg-inp" value={kind} onChange={(e) => setKind(e.target.value)}>
          {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select>
      </Field>
      <Field label="Chèn sau mục">
        <select className="dg-inp" value={afterId} onChange={(e) => setAfterId(e.target.value)}>
          <option value="">— đầu tài liệu —</option>
          {(doc?.sections || []).map((s) => <option key={s.id} value={s.id}>{s.num}. {s.title}</option>)}
        </select>
      </Field>
    </Dialog>
  );
}

function SavePresetDialog({ open, defaultName, sections, onCancel, onOk }) {
  const [name, setName] = useState("");
  useEffect(() => { if (open) setName(defaultName || ""); }, [open, defaultName]);
  return (
    <Dialog open={open} title="Lưu dàn ý này thành preset" onClose={onCancel}
      sub="Preset là dàn ý dùng lại được: áp cho project khác rồi sửa tiếp thoải mái."
      footer={<DialogButtons onCancel={onCancel} okLabel="💾 Lưu preset" okDisabled={!name.trim()}
        onOk={() => onOk(name.trim())} />}>
      <Field label="Tên preset" hint={`Lưu ${sections ?? "?"} mục đang bật, kèm thứ tự và tên mục đã sửa. Không lưu nguồn dữ liệu của project này.`}>
        <input className="dg-inp" value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) onOk(name.trim()); }} />
      </Field>
    </Dialog>
  );
}

function ApplyPresetDialog({ open, presets, onCancel, onOk }) {
  const [id, setId] = useState("");
  useEffect(() => { if (open) setId(presets[0]?.id || ""); }, [open, presets]);
  return (
    <Dialog open={open} title="Áp preset lên dàn ý" onClose={onCancel}
      sub="Preset chỉ đổi danh sách mục, thứ tự và mục nào bật — nguồn dữ liệu agent đã tìm được vẫn giữ nguyên."
      footer={<DialogButtons onCancel={onCancel} okLabel="Áp preset" okDisabled={!id} onOk={() => onOk(id)} />}>
      {presets.length ? (
        <Field label="Preset cùng chuẩn với bộ này">
          <select className="dg-inp" value={id} onChange={(e) => setId(e.target.value)}>
            {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
      ) : (
        <p>Chưa có preset nào cùng chuẩn. Lưu dàn ý hiện tại thành preset trước, rồi áp nó cho project khác.</p>
      )}
    </Dialog>
  );
}
