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
  // Chế độ tiết kiệm của tính năng tài liệu. Nằm ở một store khác (/api/agent-settings, ngưỡng
  // token cũng ở đó) nên nạp riêng — nhưng phải xuất hiện ở đây, vì đây là chỗ người dùng đi tìm
  // khi muốn biết "sao lượt chạy lại dùng model rẻ".
  const [docEco, setDocEco] = useState(null);

  useEffect(() => {
    if (!open) return;
    setModel(defaults.model || ""); setEconomy(defaults.economy !== false);
    setMaxBudgetUsd(defaults.maxBudgetUsd || 0); setSlackWebhook(defaults.slackWebhook || "");
    setDiscordWebhook(defaults.discordWebhook || "");
    setSwitchThreshold(defaults.switchThreshold || 90); setAllowCommands(defaults.allowCommands !== false);
    setDesktop(localStorage.getItem("notifyDesktop") === "1");
    fetch("/api/agent-settings").then((r) => r.json()).then((d) => setDocEco(d.economy || null)).catch(() => {});
  }, [open]); // eslint-disable-line
  if (!open) return null;

  const setEco = (patch) => {
    const next = { ...docEco, ...patch };
    setDocEco(next);
    fetch("/api/agent-settings", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ economy: next }),
    }).then((r) => r.json()).then((d) => setDocEco(d.economy || next)).catch(() => {});
  };

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

        {docEco && (() => {
          // Đang trong giai đoạn phát triển thì cấu hình bị ép, chỉ hiện để xem. Cho sửa rồi bỏ qua
          // là tệ hơn hẳn so với nói thẳng là đang bị khoá.
          const lk = !!docEco.locked;
          const off = (k) => lk || !docEco.on;
          return (
            <>
              <div className="set-sep">📚 Sinh tài liệu — tiết kiệm khi test</div>
              {lk && <div className="modal-req">🔒 {docEco.lockReason}</div>}
              <label className="eco-line">
                <input type="checkbox" checked={!!docEco.on} disabled={lk}
                  onChange={(e) => setEco({ on: e.target.checked })} />
                <span>{lk ? "🔒" : "💰"} Bật chế độ tiết kiệm</span>
              </label>
              {!lk && <div className="modal-req">Tắt: mỗi lượt viết 4–6 mục tốn 230K–630K token như đo
                được. Bật: siết theo các mục dưới.</div>}

              <label className="eco-line">
                <input type="checkbox" checked={!!docEco.forceModel} disabled={off()}
                  onChange={(e) => setEco({ forceModel: e.target.checked })} />
                <span>🧠 Ép model rẻ cho phiên sinh tài liệu</span>
              </label>
              {docEco.on && docEco.forceModel && (
                <label className="fld">
                  <span>Model dùng khi tiết kiệm</span>
                  <select value={docEco.model} disabled={lk} onChange={(e) => setEco({ model: e.target.value })}>
                    <option value="claude-haiku-4-5-20251001">Haiku 4.5 — rẻ nhất</option>
                    <option value="claude-sonnet-5">Sonnet 5 — trung bình</option>
                    <option value="claude-opus-5">Opus 5 — đắt nhất, văn tốt nhất</option>
                    {docEco.model && !["claude-haiku-4-5-20251001", "claude-sonnet-5", "claude-opus-5"]
                      .includes(docEco.model) && <option value={docEco.model}>{docEco.model}</option>}
                  </select>
                </label>
              )}

              <div className="fld-row">
                <label className="eco-line" style={{ flex: 1 }}>
                  <input type="checkbox" checked={!!docEco.capSections} disabled={off()}
                    onChange={(e) => setEco({ capSections: e.target.checked })} />
                  <span>✂️ Giới hạn số mục mỗi lượt viết</span>
                </label>
                <label className="fld budget-fld">
                  <span>mục/lượt</span>
                  <input type="number" min="1" max="50" value={docEco.maxSectionsPerRun}
                    disabled={off() || !docEco.capSections}
                    onChange={(e) => setEco({ maxSectionsPerRun: Math.min(50, Math.max(1, Number(e.target.value) || 1)) })} />
                </label>
              </div>

              <label className="eco-line">
                <input type="checkbox" checked={!!docEco.shortPrompt} disabled={off()}
                  onChange={(e) => setEco({ shortPrompt: e.target.checked })} />
                <span>📝 Prompt rút gọn — còn ~1/3 độ dài, vẫn giữ luật về nguồn</span>
              </label>

              {/* blockSurvey KHÔNG bị ép: nó tắt tính năng chứ không làm rẻ hơn, và luồng khảo sát
                  vẫn còn phải kiểm. Vì vậy nó sửa được cả khi đang bị khoá. */}
              <label className="eco-line">
                <input type="checkbox" checked={!!docEco.blockSurvey} disabled={!docEco.on}
                  onChange={(e) => setEco({ blockSurvey: e.target.checked })} />
                <span>🚫 Chặn khảo sát và đề xuất lại dàn ý (dùng preset thay thế)</span>
              </label>
              <div className="modal-req">Các mục này lưu ngay khi bấm, không cần bấm Lưu cài đặt.</div>
            </>
          );
        })()}

        <div className="modal-foot">
          <span className="run-preview" />
          <button className="primary" onClick={save}>💾 Lưu cài đặt</button>
        </div>
      </div>
    </div>
  );
}
