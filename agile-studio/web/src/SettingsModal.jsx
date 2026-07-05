import React, { useState, useEffect } from "react";

// Cài đặt chung: model/economy/budget mặc định + Slack webhook + thông báo desktop.
export default function SettingsModal({ open, onClose, models, defaults, onSaved }) {
  const [model, setModel] = useState("");
  const [economy, setEconomy] = useState(true);
  const [maxBudgetUsd, setMaxBudgetUsd] = useState(0);
  const [slackWebhook, setSlackWebhook] = useState("");
  const [discordWebhook, setDiscordWebhook] = useState("");
  const [switchThreshold, setSwitchThreshold] = useState(90);
  const [allowCommands, setAllowCommands] = useState(true);
  const [desktop, setDesktop] = useState(localStorage.getItem("notifyDesktop") === "1");

  useEffect(() => {
    if (!open) return;
    setModel(defaults.model || ""); setEconomy(defaults.economy !== false);
    setMaxBudgetUsd(defaults.maxBudgetUsd || 0); setSlackWebhook(defaults.slackWebhook || "");
    setDiscordWebhook(defaults.discordWebhook || "");
    setSwitchThreshold(defaults.switchThreshold || 90); setAllowCommands(defaults.allowCommands !== false);
    setDesktop(localStorage.getItem("notifyDesktop") === "1");
  }, [open]); // eslint-disable-line
  if (!open) return null;

  const toggleDesktop = async (on) => {
    if (on && "Notification" in window && Notification.permission !== "granted") {
      const p = await Notification.requestPermission();
      if (p !== "granted") { setDesktop(false); return; }
    }
    setDesktop(on); localStorage.setItem("notifyDesktop", on ? "1" : "0");
  };

  const save = async () => {
    await fetch("/api/settings", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, economy, maxBudgetUsd, slackWebhook, discordWebhook, switchThreshold, allowCommands }),
    });
    onSaved({ model, economy, maxBudgetUsd, slackWebhook, discordWebhook, switchThreshold, allowCommands }); onClose();
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><span>⚙ Cài đặt</span><button onClick={onClose}>✕</button></div>

        <div className="fld-row">
          <label className="fld">
            <span>🧠 Model mặc định</span>
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="">Mặc định (theo account)</option>
              {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              {model && !models.some((m) => m.id === model) && <option value={model}>{model}</option>}
            </select>
          </label>
          <label className="fld budget-fld">
            <span>$/node</span>
            <input type="number" min="0" step="0.1" value={maxBudgetUsd}
              onChange={(e) => setMaxBudgetUsd(Math.max(0, Number(e.target.value) || 0))} />
          </label>
        </div>

        <label className="eco-line">
          <input type="checkbox" checked={economy} onChange={(e) => setEconomy(e.target.checked)} />
          <span>♻️ Tiết kiệm token mặc định</span>
        </label>

        <label className="eco-line">
          <input type="checkbox" checked={allowCommands} onChange={(e) => setAllowCommands(e.target.checked)} />
          <span>⚙️ Cho agent chạy lệnh (build/test/git) — cần để Dev/QC verify được</span>
        </label>
        {!allowCommands && <div className="modal-req">Tắt: agent chỉ đọc/ghi file, KHÔNG chạy được build/test → sẽ báo "permission denied" khi verify.</div>}

        <label className="fld">
          <span>🔔 Slack webhook (báo khi done/lỗi/hết quota)</span>
          <input value={slackWebhook} onChange={(e) => setSlackWebhook(e.target.value)}
            placeholder="https://hooks.slack.com/services/…" />
        </label>

        <label className="fld">
          <span>💬 Discord webhook (thông báo — không cần chạy bot)</span>
          <input value={discordWebhook} onChange={(e) => setDiscordWebhook(e.target.value)}
            placeholder="https://discord.com/api/webhooks/…" />
        </label>

        <label className="eco-line">
          <input type="checkbox" checked={desktop} onChange={(e) => toggleDesktop(e.target.checked)} />
          <span>🖥 Thông báo desktop (trình duyệt này)</span>
        </label>

        <div className="modal-foot">
          <span className="run-preview" />
          <button className="primary" onClick={save}>💾 Lưu cài đặt</button>
        </div>
      </div>
    </div>
  );
}
