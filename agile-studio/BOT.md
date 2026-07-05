# Discord bot — điều khiển Agile Studio từ xa

Bot chạy **cùng máy** với server (gọi `localhost:4311`) và kết nối **ra** Discord, nên
**không cần expose tool ra internet**. Điều khiển từ điện thoại qua app Discord.

## Cài đặt

1. **Tạo bot Discord:**
   - Vào https://discord.com/developers/applications → New Application → tab **Bot** → Reset Token → copy **token**.
   - Trong tab Bot, bật **MESSAGE CONTENT INTENT**.
   - Tab **OAuth2 → URL Generator**: scopes `bot`, quyền `Send Messages` + `Read Message History` → mở link, mời bot vào server của bạn.
   - Lấy **Channel ID**: bật Developer Mode (User Settings → Advanced), chuột phải kênh → Copy ID.

2. **Cấu hình** — tạo file `~/.agile-studio/bot.json`:
   ```json
   {
     "discordToken": "TOKEN_CỦA_BOT",
     "channelId": "ID_KÊNH_NHẬN_LỆNH_VÀ_THÔNG_BÁO",
     "api": "http://localhost:4311",
     "prefix": "!"
   }
   ```
   (hoặc dùng env `DISCORD_TOKEN`, `DISCORD_CHANNEL`, `AGILE_API`.)

3. **Cài & chạy:**
   ```bash
   npm install        # cài discord.js
   npm run server     # tool (nếu chưa chạy)
   npm run bot        # bot (cửa sổ riêng)
   ```

## Lệnh (prefix `!`)

| Lệnh | Tác dụng |
|------|----------|
| `!help` | Danh sách lệnh |
| `!projects` | Liệt kê project (kèm id) |
| `!sessions` / `!ps` | Liệt kê session (id · trạng thái · feature) |
| `!run <projectId> <mô tả feature>` | Tạo session mới (full luồng) |
| `!queue <sessionId> <message>` | Thêm yêu cầu vào queue của session |
| `!pause <sessionId>` | Tạm dừng |
| `!resume <sessionId>` | Chạy tiếp |
| `!rm <sessionId>` | Xoá session |

## Thông báo
- **Có chạy bot:** bot tự đẩy done/lỗi/tạm dừng/hết quota vào kênh.
- **Không muốn chạy bot:** chỉ cần **Discord webhook** — ⚙ Cài đặt → dán *Discord webhook* (Channel → Edit → Integrations → Webhooks). Tool sẽ POST thông báo trực tiếp, không cần process bot.
