import React, { useEffect, useState, useCallback } from "react";
import { PRESETS, ROLE_ORDER, ROLE_META, presetOf } from "./presets.js";

const KINDS = [
  { id: "once", label: "Một lần", hint: "chạy 1 lần vào thời điểm chọn" },
  { id: "daily", label: "Hàng ngày", hint: "mỗi ngày vào giờ HH:MM" },
  { id: "interval", label: "Định kỳ", hint: "lặp lại mỗi N phút" },
];
const fmt = (t) => (t ? new Date(t).toLocaleString() : "—");

export default function ScheduleTab({ projects, defaultProjectId, models, version }) {
  const [list, setList] = useState([]);
  const [projectId, setProjectId] = useState(defaultProjectId || projects[0]?.id || "");
  const [feature, setFeature] = useState("");
  const [description, setDescription] = useState("");
  const [roles, setRoles] = useState(ROLE_ORDER);
  const [model, setModel] = useState("");
  const [kind, setKind] = useState("once");
  const [at, setAt] = useState("");
  const [everyMin, setEveryMin] = useState(60);
  const [err, setErr] = useState("");

  const load = useCallback(() => { fetch("/api/schedules").then((r) => r.json()).then(setList).catch(() => {}); }, []);
  useEffect(load, [load, version]);

  const enabled = ROLE_ORDER.filter((r) => roles.includes(r));
  const activePreset = presetOf(enabled)?.id;
  const applyPreset = (p) => setRoles(p.roles);
  const toggleRole = (id) => setRoles((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const create = async () => {
    setErr("");
    if (!projectId || !feature.trim()) { setErr("Cần chọn project và tên feature"); return; }
    const body = { projectId, feature: feature.trim(), note: description.trim(), roles: enabled, model, kind };
    if (kind === "once") { if (!at) { setErr("Chọn thời điểm"); return; } body.at = new Date(at).toISOString(); }
    else if (kind === "daily") { if (!at) { setErr("Chọn giờ"); return; } body.at = at; }
    else body.everyMin = Math.max(1, Number(everyMin) || 60);
    const r = await fetch("/api/schedules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json());
    if (r.error) { setErr(r.error); return; }
    setFeature(""); setDescription(""); load();
  };
  const toggle = (id, en) => fetch(`/api/schedules/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: en }) }).then(load);
  const del = (id) => { if (confirm("Xoá lịch này?")) fetch(`/api/schedules/${id}`, { method: "DELETE" }).then(load); };

  const whenStr = (sc) => sc.kind === "once" ? `1 lần · ${fmt(sc.at)}` : sc.kind === "daily" ? `hàng ngày ${sc.at}` : `mỗi ${sc.everyMin} phút`;

  return (
    <div className="sched">
      <div className="sched-form">
        <div className="sched-title">⏰ Lên lịch chạy feature</div>
        <div className="sched-row">
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input className="sched-feature" placeholder="Tên feature (vd: DEV_06 Xuất Excel HEMIS)" value={feature} onChange={(e) => setFeature(e.target.value)} />
        </div>
        <textarea className="sched-desc" rows={2} placeholder="Mô tả chi tiết feature cần làm gì (đưa vào prompt cho agent)…"
          value={description} onChange={(e) => setDescription(e.target.value)} />

        <div className="mode-chips">
          {PRESETS.map((p) => (
            <button key={p.id} className={"mode-chip" + (activePreset === p.id ? " on" : "")} title={p.desc} onClick={() => applyPreset(p)}>{p.icon} {p.label}</button>
          ))}
        </div>
        <div className="flow-toggle sched-flow">
          {ROLE_ORDER.map((id) => (
            <button key={id} className={"ftog" + (roles.includes(id) ? " on" : "")} onClick={() => toggleRole(id)}>
              <span className="ftog-emoji">{ROLE_META[id].emoji}</span><span>{ROLE_META[id].name}</span>
            </button>
          ))}
        </div>

        <div className="sched-when">
          <div className="sched-kinds">
            {KINDS.map((k) => (
              <button key={k.id} className={"qchip" + (kind === k.id ? " on" : "")} title={k.hint} onClick={() => setKind(k.id)}>{k.label}</button>
            ))}
          </div>
          {kind === "once" && <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />}
          {kind === "daily" && <input type="time" value={at} onChange={(e) => setAt(e.target.value)} />}
          {kind === "interval" && <span className="sched-interval">mỗi <input type="number" min="1" value={everyMin} onChange={(e) => setEveryMin(e.target.value)} /> phút</span>}
          <select value={model} onChange={(e) => setModel(e.target.value)} title="Model">
            <option value="">Model mặc định</option>
            {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <button className="sched-add" onClick={create}>＋ Tạo lịch</button>
        </div>
        {err && <div className="modal-err">{err}</div>}
      </div>

      <div className="sched-list">
        {!list.length && <p className="muted">Chưa có lịch nào.</p>}
        {list.map((sc) => (
          <div className={"sched-item" + (sc.enabled ? "" : " off")} key={sc.id}>
            <div className="sched-item-main">
              <div className="sched-item-feat">{sc.feature}</div>
              {sc.note && <div className="sched-item-desc">{sc.note}</div>}
              <div className="sched-item-sub">
                <span className="tag">{sc.projectName}</span>
                <span className="tag mode">{presetOf(sc.roles)?.label || sc.roles.join("→")}</span>
                <span className="tag">🕒 {whenStr(sc)}</span>
                {sc.enabled && <span className="tag">➡ kế: {fmt(sc.nextRun)}</span>}
                {sc.lastRun && <span className="tag">✓ lần cuối: {fmt(sc.lastRun)}</span>}
              </div>
            </div>
            <div className="sched-item-acts">
              <button className={"savelog-toggle" + (sc.enabled ? " on" : "")} onClick={() => toggle(sc.id, !sc.enabled)}>{sc.enabled ? "Bật" : "Tắt"}</button>
              <button className="scard-del" onClick={() => del(sc.id)}>🗑</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
