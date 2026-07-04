# Agile Studio — dashboard kiểu n8n cho luồng Agile/Scrum trên Claude Code

Web app localhost điều khiển bộ subagent Claude Code (PM to BA to DA to DEV to QC to PO).
Claude Code chạy dưới nền (dùng token Pro của bạn), web chỉ là bảng điều khiển:
canvas luồng, node hiện đang/đã làm gì, tách project theo folder, kho requirement
theo ngày, auto-switch giữa 2 account Claude khi gần hết quota.

## Yêu cầu
1. Đã cài bộ subagent Agile (gói cc-agile-scrum trước) vào ~/.claude/.
2. Claude Code CLI (claude) có trong PATH.
3. Node 18+.

## Cấu hình 2 account (auto-switch)
Mỗi account một thư mục config riêng (cách chính thức Anthropic, KHÔNG copy token).

    # account 2:
    CLAUDE_CONFIG_DIR=~/.claude-acc2 claude   # chạy /login, đăng nhập Gmail thứ 2, thoát

Tạo ~/.agile-studio/accounts.json (xem examples/accounts.example.json).

## Chạy
    npm install
    npm run dev          # backend :4311 + web :5311
    # mở http://localhost:5311

## Dùng
1. + Project: nhập tên + đường dẫn tuyệt đối repo. Mỗi project 1 folder riêng
   nên document/ của BA/DA/QC không đè nhau giữa các dự án.
2. Tab Requirement: thêm yêu cầu khách hàng theo ngày.
3. Tab Luồng: gõ feature rồi Chạy full luồng, hoặc Chỉ Dev to QC to PO.
4. Node đang chạy hiện hành động cụ thể (đọc/viết file gì, chạy lệnh gì).
   Click node xem toàn bộ log.
5. Panel account: % quota 5h mỗi account; khi account đang dùng >= 90%,
   node kế tiếp tự chạy bằng account còn quota.

## Kiến trúc
web (React :5311) --HTTP/WS--> server (Express :4311)
  - spawn claude -p --output-format stream-json, CLAUDE_CONFIG_DIR theo account, cwd = repo
  - accounts.js: đọc % usage, tự chọn account dưới ngưỡng
  - store.js: project + requirement (JSON ~/.agile-studio)

## Giới hạn cần biết
- Auto-switch đọc % qua API usage OAuth Anthropic; API đổi format thì chỉnh accounts.js.
- macOS: credential trong Keychain (đọc qua security); Linux/Windows: file .credentials.json.
- Mỗi node là một tiến trình claude mới nên switch giữa node là sạch, không cần restart.
- Luồng nhiều subagent tốn token gấp nhiều lần; auto-switch kéo dài chứ không tạo thêm quota.
