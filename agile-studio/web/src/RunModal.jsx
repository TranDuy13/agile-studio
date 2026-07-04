import React, { useState, useEffect } from "react";
import { PRESETS, ROLE_ORDER, ROLE_META, presetOf } from "./presets.js";

// Modal cấu hình 1 lần chạy: mô tả feature + chọn mode/tuỳ chỉnh luồng + model + tiết kiệm/ngân sách.
// prefill (tuỳ chọn): { feature, presetId, requirementId } — dùng khi "Phân tích requirement".
export default function RunModal({ open, onClose, onSubmit, models, defaults, prefill }) {
  const [title, setTitle] = useState("");           // tên feature (đặt tên + dùng cho tên file)
  const [description, setDescription] = useState(""); // mô tả/yêu cầu chi tiết -> đưa vào prompt
  const [roles, setRoles] = useState(ROLE_ORDER); // tập role bật (tự chọn được)
  const [model, setModel] = useState(defaults.model || "");
  const [economy, setEconomy] = useState(defaults.economy !== false);
  const [maxBudgetUsd, setMaxBudgetUsd] = useState(defaults.maxBudgetUsd || 0);
  const [saveLog, setSaveLog] = useState(false);
  const [requirementId, setRequirementId] = useState(null);

  // Mỗi lần mở modal: nạp prefill (nếu có) + reset theo cấu hình mặc định.
  useEffect(() => {
    if (!open) return;
    setTitle(prefill?.feature || "");
    setDescription(prefill?.description || "");
    const p = PRESETS.find((x) => x.id === (prefill?.presetId || "full")) || PRESETS[0];
    setRoles(p.roles);
    setRequirementId(prefill?.requirementId || null);
    setModel(defaults.model || ""); setEconomy(defaults.economy !== false); setMaxBudgetUsd(defaults.maxBudgetUsd || 0);
    setSaveLog(false);
  }, [open]); // eslint-disable-line

  if (!open) return null;
  const enabled = ROLE_ORDER.filter((r) => roles.includes(r));
  const activePreset = presetOf(enabled)?.id;
  const applyPreset = (p) => setRoles(p.roles);
  const toggleRole = (id) => setRoles((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const submit = () => {
    if (!title.trim() || !enabled.length) return;
    // feature = tên (title); note = mô tả chi tiết đưa vào prompt cho các agent.
    onSubmit({ feature: title.trim(), note: description.trim(), roles: enabled, model, economy, maxBudgetUsd, saveLog, requirementId });
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>{requirementId ? "📥 Phân tích requirement" : "▶ Chạy feature mới"}</span>
          <button onClick={onClose}>✕</button>
        </div>

        {requirementId && <div className="modal-req">Chạy để phân tích & giải quyết requirement #{requirementId} → xong sẽ tự đánh dấu “đã giải quyết”.</div>}

        <label className="fld">
          <span>Tên feature</span>
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="vd: DEV_06 Xuất Excel template HEMIS" />
        </label>

        <label className="fld">
          <span>Mô tả / yêu cầu chi tiết <small className="hint">(đưa vào prompt cho các agent)</small></span>
          <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="Mô tả chi tiết yêu cầu, ràng buộc, tiêu chí… để agent hiểu rõ feature cần làm." />
        </label>

        <div className="fld">
          <span>Chế độ (mode)</span>
          <div className="mode-chips">
            {PRESETS.map((p) => (
              <button key={p.id} type="button" title={p.desc}
                className={"mode-chip" + (activePreset === p.id ? " on" : "")}
                onClick={() => applyPreset(p)}>{p.icon} {p.label}</button>
            ))}
          </div>
        </div>

        <div className="fld">
          <span>Luồng chạy — bấm để bật/tắt từng node</span>
          <div className="flow-toggle">
            {ROLE_ORDER.map((id, i) => {
              const on = roles.includes(id);
              return (
                <React.Fragment key={id}>
                  <button type="button" className={"ftog" + (on ? " on" : "")} onClick={() => toggleRole(id)}>
                    <span className="ftog-emoji">{ROLE_META[id].emoji}</span>
                    <span>{ROLE_META[id].name}</span>
                  </button>
                  {i < ROLE_ORDER.length - 1 && <span className="ftog-arrow">→</span>}
                </React.Fragment>
              );
            })}
          </div>
          <small className="hint">{activePreset ? PRESETS.find((p) => p.id === activePreset).desc : "Tuỳ chỉnh — chạy: " + (enabled.join(" → ") || "(chưa chọn node)")}</small>
        </div>

        <div className="fld-row">
          <label className="fld">
            <span>🧠 Model Claude</span>
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="">Mặc định (theo account)</option>
              {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              {model && !models.some((m) => m.id === model) && <option value={model}>{model}</option>}
            </select>
          </label>
          <label className="fld budget-fld">
            <span>$/node (0 = ∞)</span>
            <input type="number" min="0" step="0.1" value={maxBudgetUsd}
              onChange={(e) => setMaxBudgetUsd(Math.max(0, Number(e.target.value) || 0))} />
          </label>
        </div>

        <label className="eco-line">
          <input type="checkbox" checked={economy} onChange={(e) => setEconomy(e.target.checked)} />
          <span>♻️ Tiết kiệm token (chỉ ở Full luồng: bỏ qua node đã có tài liệu)</span>
        </label>

        <label className="eco-line">
          <input type="checkbox" checked={saveLog} onChange={(e) => setSaveLog(e.target.checked)} />
          <span>💾 Lưu log session (xem lại được sau khi tải lại / restart)</span>
        </label>

        <div className="modal-foot">
          <span className="run-preview">Chạy: {enabled.join(" → ") || "(chưa chọn)"}</span>
          <button className="primary" disabled={!title.trim() || !enabled.length} onClick={submit}>▶ Chạy ({enabled.length} node)</button>
        </div>
      </div>
    </div>
  );
}
