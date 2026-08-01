// Gửi thông báo. Ba kênh, cùng một giao diện: nhận lịch nhắc, trả về kết quả gửi.
import { markSent } from "./store.js";

const CHANNELS = {
  // Mỗi kênh trả { ok, detail }. Không kênh nào ném lỗi ra ngoài: một kênh chết không được làm
  // dừng cả vòng gửi.
  console: (r) => {
    console.log(`[nhắc] ${r.title} — ${r.at}`);
    return { ok: true, detail: "in ra stdout" };
  },
  email: (r) => {
    if (!r.to || !r.to.includes("@")) return { ok: false, detail: "địa chỉ e-mail không hợp lệ" };
    return { ok: true, detail: `xếp hàng gửi tới ${r.to}` };
  },
  sms: (r) => {
    if (!/^\+?\d{9,15}$/.test(String(r.to || ""))) return { ok: false, detail: "số điện thoại không hợp lệ" };
    return { ok: true, detail: `xếp hàng gửi tới ${r.to}` };
  },
};

export function channels() {
  return Object.keys(CHANNELS);
}

export function send(reminder) {
  const channel = CHANNELS[reminder.channel];
  if (!channel) return { ok: false, detail: `kênh "${reminder.channel}" không tồn tại` };
  const result = channel(reminder);
  if (result.ok) markSent(reminder.id);
  return result;
}

// Gửi cả lô. Trả về số gửi được và danh sách thất bại kèm lý do, để nơi gọi báo lại cho người dùng.
export function sendAll(list) {
  let sent = 0;
  const failed = [];
  for (const r of list) {
    const result = send(r);
    if (result.ok) sent++;
    else failed.push({ id: r.id, reason: result.detail });
  }
  return { sent, failed };
}
