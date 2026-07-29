import React, { useCallback, useEffect, useRef, useState } from "react";
import TokenConfirm, { TokenChip, fmtTokens, shouldAsk } from "./TokenConfirm.jsx";

// The approval gate (MH 3): the agent proposes, the user edits, and only then is the outline
// frozen. Nothing downstream has a stable denominator until this screen is done (Q8).

const ENGINES = [
  { id: "per-doc", label: "Song song theo tài liệu", sub: "Nhanh · tạm dừng, đổi account được" },
  { id: "single", label: "Tuần tự một phiên", sub: "Nhất quán thuật ngữ cao nhất · chậm hơn" },
  { id: "per-section", label: "Song song theo mục", sub: "Nhanh nhất · tốn token nhất" },
];

const levelOf = (num) => Math.min(3, String(num).split(".").length + 1); // doc row is level 1

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
  const [ask, setAsk] = useState(null);           // "write" | "revise"
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

  const approved = !!plan?.approvedAt;

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

  const mutateDoc = (docKey, fn) => {
    const next = JSON.parse(JSON.stringify(planRef.current));
    const doc = next.docs.find((d) => d.key === docKey);
    if (!doc) return;
    fn(doc, next);
    save(next);
  };

  const toggleSection = (docKey, id) =>
    mutateDoc(docKey, (doc) => {
      const s = doc.sections.find((x) => x.id === id);
      if (s) { s.enabled = s.enabled === false; s.userEnabled = s.enabled; }
    });

  const renameSection = (docKey, id, title) =>
    mutateDoc(docKey, (doc) => {
      const s = doc.sections.find((x) => x.id === id);
      if (s && title.trim()) { s.title = title.trim(); s.userTitle = true; }
    });

  const addSection = (docKey) => {
    const title = prompt("Tên mục mới (giữ tiếng Anh nếu là tên mục của chuẩn):");
    if (!title?.trim()) return;
    mutateDoc(docKey, (doc) => {
      const num = `${doc.sections.length + 1}`;
      doc.sections.push({
        id: `${docKey}/u${Date.now().toString(36)}`, num, title: title.trim(),
        kind: "explanation", required: false, hint: "Mục do người dùng thêm",
        accept: { minBlocks: 1, minSources: 1 }, from: [], sources: [],
        origin: "user", enabled: true, status: "pending", words: 0,
      });
    });
  };

  const removeSection = (docKey, id) =>
    mutateDoc(docKey, (doc) => { doc.sections = doc.sections.filter((s) => s.id !== id); });

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
    else { setRevise(""); onJobChanged?.(); }
  };

  const approve = async () => {
    setBusy("approve"); setErr("");
    const r = await fetch(`/api/doc-jobs/${jobId}/plan/approve`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ engine }),
    }).then((x) => x.json()).catch((e) => ({ error: String(e.message) }));
    setBusy("");
    if (r.error) return setErr(r.error);
    setPlan(r.plan); planRef.current = r.plan; setStats(r.stats); setJob(r.job);
    onJobChanged?.();
  };

  const savePreset = async () => {
    const name = prompt("Tên preset (dùng lại cho project khác):", `${job?.name} — dàn ý`);
    if (!name?.trim()) return;
    const r = await fetch(`/api/doc-jobs/${jobId}/plan/save-preset`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }),
    }).then((x) => x.json());
    if (r.error) setErr(r.error);
    else setPresets((s) => [r.preset, ...s.filter((p) => p.id !== r.preset.id)]);
  };

  const applyPreset = async (presetId) => {
    if (!presetId) return;
    const r = await fetch(`/api/doc-jobs/${jobId}/plan/apply-preset`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ presetId }),
    }).then((x) => x.json());
    if (r.error) setErr(r.error);
    else { setPlan(r.plan); planRef.current = r.plan; setStats(r.stats); }
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
        <div className="dg-card">
          <p className="dg-muted" style={{ fontSize: 12 }}>Chưa có dàn ý. Cho agent khảo sát mã nguồn để đề xuất,
            hoặc áp một preset đã lưu (không tốn token).</p>
          <div className="dg-row" style={{ marginTop: 10 }}>
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
          {err && <div className="dg-err" style={{ marginTop: 10 }}>{err}</div>}
        </div>
      )}
    </div>
  );

  const writeTokens = stats?.estTokens || 0;
  const windows = writeTokens / (settings?.tokensPer5h || 2000000);
  const leftPct = est?.usage?.fiveHourPct != null ? Math.max(0, 100 - Math.round(est.usage.fiveHourPct)) : null;
  const optionalOn = plan.docs.flatMap((d) => d.sections)
    .filter((s) => !s.required && s.enabled !== false).length;
  const overBudget = leftPct != null && windows * 100 > leftPct;

  return (
    <div className="dg-pane">
      <div className="dg-head">
        <button className="mini" onClick={onBack}>← Danh sách</button>
        <b className="dg-h1">{job?.name}</b>
        <span className="pill acc">{job?.standardLabel}</span>
        {approved
          ? <span className="pill ok">✓ dàn ý đã chốt</span>
          : <span className="pill acc">⏸ chờ duyệt dàn ý</span>}
        <span className="pill">{stats?.docs ?? plan.docs.length} tài liệu · {stats?.sections ?? 0} mục</span>
        <span className="dg-spacer" />
        <span className="dg-sub">
          {job?.survey?.elapsedMs ? `khảo sát ${Math.round(job.survey.elapsedMs / 1000)}s · ` : ""}
          {job?.survey?.tokens ? `${fmtTokens(job.survey.tokens)} tok · ` : ""}
          bản sửa {plan.revision}
        </span>
      </div>

      {err && <div className="dg-err">{err}</div>}
      {job?.survey?.warning && <div className="dg-note">⚠ Phiên khảo sát thoát bất thường nhưng vẫn ghi được
        kết quả nên dàn ý dưới đây là hợp lệ. Lý do CLI báo: {job.survey.warning}</div>}
      {approved && <div className="dg-note">Dàn ý đã đóng băng thành kế hoạch: {stats?.sections} mục là mẫu số
        cho mọi con số tiến độ về sau. Viết nội dung là bước kế tiếp (D2).</div>}

      <div className="dg-outline">
        <div className="dg-card">
          <div className="dg-row" style={{ marginBottom: 9 }}>
            <button className="mini" disabled={approved} onClick={() => addSection(plan.docs[0].key)}>＋ Thêm mục</button>
            <select className="dg-inp" style={{ padding: "4px 8px", fontSize: 10.5 }} value="" disabled={approved}
              onChange={(e) => { applyPreset(e.target.value); e.target.value = ""; }}>
              <option value="">Áp preset…</option>
              {presets.filter((p) => p.standardId === job?.standardId)
                .map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button className="mini" onClick={savePreset}>💾 Lưu dàn ý này thành preset</button>
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
                    draggable={!approved && !editing}
                    onDragStart={() => setDrag({ docKey: doc.key, index: i })}
                    onDragOver={(e) => { e.preventDefault(); setOver({ docKey: doc.key, index: i }); }}
                    onDragLeave={() => setOver(null)}
                    onDrop={(e) => { e.preventDefault(); onDrop(doc.key, i); }}>
                    <span className="grip" title="Kéo để đổi thứ tự">⠿</span>
                    <button className="tgl" disabled={approved} title={s.enabled === false ? "Bật mục" : "Tắt mục"}
                      onClick={() => toggleSection(doc.key, s.id)}>{s.enabled === false ? "☐" : "☑"}</button>
                    {editing === s.id ? (
                      <input className="rename" autoFocus defaultValue={s.title}
                        onBlur={(e) => { renameSection(doc.key, s.id, e.target.value); setEditing(null); }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                          if (e.key === "Escape") setEditing(null);
                        }} />
                    ) : (
                      <span className="nm" onDoubleClick={() => !approved && setEditing(s.id)}
                        title="Bấm đúp để đổi tên">
                        {s.num}. <abbr className="tt" title={s.hint}>{s.title}</abbr>
                        {s.origin === "agent" && <span className="pill acc" style={{ marginLeft: 6 }}>agent đề xuất</span>}
                        {s.required && <span className="pill" style={{ marginLeft: 6 }}>bắt buộc</span>}
                        {s.proposedDrop && s.enabled !== false &&
                          <span className="pill err" style={{ marginLeft: 6 }} title={s.note}>agent đề xuất bỏ</span>}
                      </span>
                    )}
                    <span className="src" title={(s.sources || []).join("\n") || s.note}>
                      {s.sources?.length ? s.sources.slice(0, 2).join(" · ") : (s.note || "—")}
                    </span>
                    {s.origin === "user" && !approved &&
                      <button className="mini danger" onClick={() => removeSection(doc.key, s.id)}>✕</button>}
                  </div>
                ))}
              </React.Fragment>
            ))}
          </div>
        </div>

        <div className="dg-side">
          <div className="dg-card">
            <div className="dg-label" style={{ marginBottom: 8 }}>Cách chạy <span className="dg-dim">· đổi được giữa chừng</span></div>
            {ENGINES.map((e) => (
              <button key={e.id} className={"dg-chk" + (engine === e.id ? " on" : "")} style={{ marginBottom: 6 }}
                disabled={approved} onClick={() => setEngine(e.id)}>
                <i className="bx radio">{engine === e.id ? "●" : ""}</i>
                <span className="dg-chk-t"><b>{e.label}</b><span>{e.sub}</span></span>
              </button>
            ))}
          </div>

          <div className="dg-card">
            <div className="dg-label" style={{ marginBottom: 8 }}>Dự báo chi phí</div>
            <div className="dg-stat"><span>Viết cả bộ</span><b>~{fmtTokens(writeTokens)} token</b></div>
            <div className="dg-stat"><span>Quy đổi</span><b>≈ {windows.toFixed(windows < 1 ? 2 : 1)} cửa sổ 5h</b></div>
            <div className="dg-stat">
              <span>Account</span>
              <b>{est?.account?.label || est?.account?.id || "—"}{leftPct != null ? ` · còn ${leftPct}%` : ""}</b>
            </div>
            {overBudget && (
              <div className="dg-note" style={{ marginTop: 8, borderColor: "var(--error)" }}>
                Vượt phần quota còn lại của account đang chọn. Tắt bớt {optionalOn} mục không bắt buộc,
                hoặc đổi account — tổng cập nhật ngay khi tắt.
              </div>
            )}
            <p className="dg-note" style={{ marginTop: 8 }}>Đây là <b>ước tính có sai số lớn</b>: chi phí thật
              phụ thuộc mã nguồn phải đọc. Con số thật cập nhật dần khi chạy.</p>
          </div>

          {job?.facts?.items?.length > 0 && (
            <div className="dg-card">
              <div className="dg-label" style={{ marginBottom: 8 }}>Agent phát hiện</div>
              {job.facts.items.map((f, i) => (
                <div className={"dg-fact" + (f.level === "warn" ? " warn" : "")} key={i}>
                  <i>{f.level === "warn" ? "!" : "✓"}</i><span>{f.text}</span>
                </div>
              ))}
            </div>
          )}

          <div className="dg-field">
            <span className="dg-label">Yêu cầu agent sửa dàn ý</span>
            <textarea className="dg-inp" rows={2} value={revise} disabled={approved}
              placeholder="vd: Gộp 6.1 vào mục 8. Tách job nền thành từng job một."
              onChange={(e) => setRevise(e.target.value)} />
          </div>
          <button className="ghost" disabled={approved || !revise.trim() || busy === "revise"}
            onClick={() => (shouldAsk("revise", est?.revise || 0, settings) ? setAsk("revise") : runRevise())}>
            {busy === "revise" ? "Đang gửi…" : "↻ Đề xuất lại dàn ý"}{" "}
            <TokenChip tokens={est?.revise || 0} threshold={settings?.tokenThreshold} />
          </button>

          <button className="primary" disabled={approved || busy === "approve"}
            onClick={() => (shouldAsk("write", writeTokens, settings) ? setAsk("write") : approve())}>
            {approved ? "✓ Đã duyệt" : busy === "approve" ? "Đang chốt…" : "✔ Duyệt & chốt dàn ý"}{" "}
            <TokenChip tokens={writeTokens} threshold={settings?.tokenThreshold} />
          </button>
          <p className="dg-note">Duyệt xong dàn ý đóng băng. Viết nội dung theo dàn ý này là bước kế tiếp.</p>
        </div>
      </div>

      <TokenConfirm open={!!ask} kind={ask || "write"} settings={settings}
        tokens={ask === "revise" ? (est?.revise || 0) : writeTokens}
        account={est?.account} usage={est?.usage} spent={job?.metrics?.tokens || 0}
        onCancel={() => setAsk(null)}
        onConfirm={(dontAsk) => {
          const kind = ask; setAsk(null);
          if (dontAsk) onSettings({ dontAsk: { ...(settings?.dontAsk || {}), [kind]: true } });
          if (kind === "revise") runRevise(); else approve();
        }} />
    </div>
  );
}
