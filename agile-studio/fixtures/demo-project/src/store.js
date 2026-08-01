// Lưu lịch nhắc. Bộ nhớ tiến trình là đủ: đây là repo mẫu, không phải sản phẩm chạy thật.
const rows = new Map();
let seq = 1;

export function insert(reminder) {
  const id = `RMD-${String(seq++).padStart(4, "0")}`;
  const row = { id, ...reminder, createdAt: new Date().toISOString(), sentAt: null };
  rows.set(id, row);
  return row;
}

export function get(id) {
  return rows.get(id) || null;
}

// Lịch đến giờ mà chưa gửi. Vòng lặp gửi thông báo gọi hàm này mỗi phút.
export function due(now = Date.now()) {
  return [...rows.values()].filter((r) => !r.sentAt && new Date(r.at).getTime() <= now);
}

export function markSent(id) {
  const row = rows.get(id);
  if (!row) return null;
  row.sentAt = new Date().toISOString();
  return row;
}

export function count() {
  return rows.size;
}
