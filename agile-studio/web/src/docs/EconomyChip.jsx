import React, { useEffect, useState } from "react";
import Dialog, { DialogButtons, Field } from "./Dialog.jsx";

// Chế độ tiết kiệm khi test — công tắc nhanh trên thanh chạy + hộp cấu hình chi tiết.
//
// Mặc định BẬT (xem server/docgen/economy.js). Chip luôn hiện, kể cả khi tắt, vì "đang chạy ở chế
// độ đắt" là thông tin cần thấy trước khi bấm, không phải sau khi hết quota.

const MODELS = [
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5 — rẻ nhất" },
  { id: "claude-sonnet-5", label: "Sonnet 5 — trung bình" },
  { id: "claude-opus-5", label: "Opus 5 — đắt nhất, văn tốt nhất" },
];

export function EconomyChip({ economy, onChange, onConfigure }) {
  if (!economy) return null;
  const on = !!economy.on;
  const locked = !!economy.locked;
  // `notes` do server tính (economyOf) và gửi kèm mọi endpoint trả economy. Không suy lại ở đây:
  // thêm một nút tiết kiệm thì chỉ phải sửa một chỗ.
  const notes = economy.notes?.length ? economy.notes : [];
  return (
    <span className={"dg-eco" + (on ? " on" : "") + (locked ? " locked" : "")}>
      {/* Đang bị ép thì ô tick phải KHOÁ, không phải bấm được rồi im lặng không có tác dụng. */}
      <label title={locked ? economy.lockReason
        : on ? "Đang siết chi phí: " + notes.join(" · ")
        : "Đang chạy đúng như thật — tốn token như một lượt viết bình thường"}>
        <input type="checkbox" checked={on} disabled={locked}
          onChange={(e) => onChange({ on: e.target.checked })} />
        {locked ? "🔒" : "💰"} Tiết kiệm khi test
      </label>
      {on
        ? <em className="dg-eco-notes">{notes.join(" · ")}</em>
        : <em className="dg-eco-notes warn">chạy đủ giá</em>}
      <button className="mini" onClick={onConfigure}
        title={locked ? "Xem cấu hình đang bị ép" : "Chọn siết những gì"}>⚙</button>
    </span>
  );
}

export function EconomyDialog({ open, economy, onCancel, onSave }) {
  const [v, setV] = useState(null);
  useEffect(() => { if (open && economy) setV({ ...economy }); }, [open, economy]);
  if (!open || !v) return null;

  const locked = !!economy.locked;
  const set = (patch) => setV((s) => ({ ...s, ...patch }));
  // Đang bị ép: mọi nút chỉ đọc. Cho sửa rồi bỏ qua là tệ hơn không cho sửa.
  const row = (key, title, sub, extra = null) => (
    <div className={"dg-chk" + (v[key] ? " on" : "") + (v.on && !locked ? "" : " dim")}>
      <label>
        <input type="checkbox" checked={!!v[key]} disabled={!v.on || locked}
          onChange={(e) => set({ [key]: e.target.checked })} />
        <span className="dg-chk-t"><b>{title}</b><span>{sub}</span></span>
      </label>
      {extra}
    </div>
  );

  return (
    <Dialog open={open} title="Tiết kiệm khi test" width={620} onClose={onCancel}
      sub="Siết chi phí của các lượt chạy tốn token. Từng nút bật/tắt riêng vì mỗi nút đánh đổi một thứ khác nhau."
      footer={locked
        ? <DialogButtons onCancel={onCancel} cancelLabel="Đóng" />
        : <DialogButtons onCancel={onCancel} okLabel="💾 Lưu" onOk={() => onSave(v)} />}>

      {locked && (
        <div className="dg-note warn">🔒 {economy.lockReason} Cấu hình dưới đây là bản đang có hiệu lực,
          chỉ để xem.</div>
      )}

      <div className={"dg-chk big" + (v.on ? " on" : "") + (locked ? " dim" : "")}>
        <label>
          <input type="checkbox" checked={!!v.on} disabled={locked}
            onChange={(e) => set({ on: e.target.checked })} />
          <span className="dg-chk-t">
            <b>Bật chế độ tiết kiệm</b>
            <span>Tắt đi là mọi lượt chạy đúng như thật — một lượt viết 4–6 mục đo được 230K–630K token.</span>
          </span>
        </label>
      </div>

      {row("forceModel", "Ép model rẻ",
        "Bỏ qua model ở Cài đặt chung cho mọi phiên của tính năng tài liệu.",
        <select className="dg-inp" value={v.model} disabled={!v.on || !v.forceModel}
          onChange={(e) => set({ model: e.target.value })}>
          {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          {v.model && !MODELS.some((m) => m.id === v.model) && <option value={v.model}>{v.model}</option>}
        </select>)}

      {row("capSections", "Giới hạn số mục mỗi lượt",
        "Phần còn lại giữ nguyên trạng thái chờ — bấm Tiếp tục để viết nốt. Chặn cả trường hợp bấm nhầm vào bộ 41 mục.",
        <label className="dg-eco-num">
          tối đa
          <input className="dg-inp" type="number" min="1" max="50" value={v.maxSectionsPerRun}
            disabled={!v.on || !v.capSections}
            onChange={(e) => set({ maxSectionsPerRun: Math.min(50, Math.max(1, Number(e.target.value) || 1)) })} />
          mục
        </label>)}

      {row("shortPrompt", "Prompt rút gọn",
        "Bỏ phần văn phong và lược đồ 9 loại khối, yêu cầu mỗi mục 1–2 khối ngắn. Còn khoảng 1/3 độ dài, "
        + "vẫn giữ luật về nguồn và đường dẫn ghi tệp.")}

      {row("blockSurvey", "Chặn khảo sát và đề xuất lại dàn ý",
        "Khảo sát là khoản đắt thứ hai sau viết. Chặn rồi thì dàn ý phải lấy từ preset (miễn phí) "
        + "hoặc sửa tay. Mặc định TẮT để còn test được luồng khảo sát.")}

      <p className="dg-note">Cấu hình này dùng chung cho toàn Studio, không phải theo từng bộ tài liệu.
        Dự báo token trên các nút tự tính lại theo những gì đang bật ở đây.</p>
    </Dialog>
  );
}

// Hook nhỏ: đọc/ghi economy qua /api/agent-settings, dùng ở cả DocProgress và DocOutline.
export function useEconomy(settings, onSettings) {
  const [dialog, setDialog] = useState(false);
  const economy = settings?.economy || null;
  return {
    economy,
    dialogOpen: dialog,
    openDialog: () => setDialog(true),
    closeDialog: () => setDialog(false),
    patch: (p) => onSettings?.({ economy: { ...(economy || {}), ...p } }),
    save: (next) => { onSettings?.({ economy: next }); setDialog(false); },
  };
}
