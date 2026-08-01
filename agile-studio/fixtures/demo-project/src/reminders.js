// Tạo và tra cứu lịch nhắc. Đây là cửa vào của sản phẩm.
import { insert, get, due, count } from "./store.js";
import { channels, sendAll } from "./notify.js";

const MAX_TITLE = 120;

// Kiểm khuôn dạng trước khi ghi. Trả lỗi thành mảng để nơi gọi hiện hết một lượt, không bắt người
// dùng sửa từng lỗi một.
export function validate(input) {
  const errors = [];
  const title = String(input?.title || "").trim();
  if (!title) errors.push("Thiếu tiêu đề.");
  if (title.length > MAX_TITLE) errors.push(`Tiêu đề dài quá ${MAX_TITLE} ký tự.`);
  if (!input?.at || isNaN(new Date(input.at).getTime())) errors.push("Thời điểm nhắc không đọc được.");
  else if (new Date(input.at).getTime() < Date.now()) errors.push("Thời điểm nhắc đã ở quá khứ.");
  if (!channels().includes(input?.channel)) errors.push(`Kênh phải là một trong: ${channels().join(", ")}.`);
  return errors;
}

export function create(input) {
  const errors = validate(input);
  if (errors.length) return { ok: false, errors };
  const row = insert({
    title: String(input.title).trim(),
    at: new Date(input.at).toISOString(),
    channel: input.channel,
    to: input.to || "",
  });
  return { ok: true, reminder: row };
}

export function find(id) {
  const row = get(id);
  return row ? { ok: true, reminder: row } : { ok: false, errors: [`Không thấy lịch nhắc ${id}.`] };
}

// Một lượt quét: lấy lịch đến giờ rồi gửi. Vòng lặp nền gọi mỗi phút.
export function tick(now = Date.now()) {
  const list = due(now);
  if (!list.length) return { checked: count(), sent: 0, failed: [] };
  return { checked: count(), ...sendAll(list) };
}

if (process.argv[1] && process.argv[1].endsWith("reminders.js")) {
  const soon = new Date(Date.now() + 1000).toISOString();
  console.log(create({ title: "Họp giao ban", at: soon, channel: "console" }));
  setTimeout(() => console.log(tick()), 1200);
}
