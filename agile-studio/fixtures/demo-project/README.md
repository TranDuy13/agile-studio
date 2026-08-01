# stale-demo — dịch vụ nhắc lịch

Repo mẫu đi kèm Agile Studio. Nó tồn tại để bấm thử tính năng sinh tài liệu mà không phải trả tiền
đọc một repo thật: cả sản phẩm chỉ có ba tệp nguồn, nên một lượt khảo sát hay một lượt viết chỉ tốn
một phần rất nhỏ so với repo thường.

## Sản phẩm này làm gì

Nhận một lịch nhắc, đến giờ thì gửi thông báo. Một người dùng tạo nhiều lịch; mỗi lịch có một khung
giờ và một kênh gửi.

## Cấu trúc

| Đường dẫn | Trách nhiệm |
|---|---|
| `src/reminders.js` | Tạo và tra cứu lịch nhắc |
| `src/notify.js` | Gửi thông báo qua kênh đã chọn |
| `src/store.js` | Lưu lịch nhắc trong bộ nhớ |

## Chạy

```bash
node src/reminders.js
```

Không có phụ thuộc ngoài, không có bước build.
