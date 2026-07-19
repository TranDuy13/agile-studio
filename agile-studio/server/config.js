// Cấu hình tập trung — NGUỒN DUY NHẤT đọc biến môi trường (.env).
// Nạp dotenv ở đây, và import module này SỚM NHẤT để mọi nơi khác đọc được env.
// Giữ mặc định = hành vi cũ, nên khi KHÔNG có .env thì chạy y như trước.
import "dotenv/config";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), ".."); // .../agile-studio

export const config = {
  appRoot: APP_ROOT,
  // Nơi lưu state của app (studio.json, danh sách account…).
  dataDir: process.env.DATA_DIR || join(homedir(), ".agile-studio"),
  // Workspace tài liệu managed theo từng project.
  projectsDir: process.env.PROJECTS_DIR || join(APP_ROOT, "projects"),
  // File đính kèm của requirement.
  requirementsDir: process.env.REQUIREMENTS_DIR || join(APP_ROOT, "requirements"),
  // Thư viện skill tổng (.skill/).
  skillsDir: process.env.AGILE_SKILLS_DIR || join(APP_ROOT, ".skill"),
  // Config dir mặc định của Claude Code.
  claudeConfigDir: process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"),
  // Đường dẫn Claude CLI (tuỳ chọn) — nếu đặt sẽ ưu tiên trước khi tự dò (xem claudeBin.js).
  claudeBin: process.env.CLAUDE_BIN || process.env.CLAUDE_CLI_PATH || "",
  // Cổng API server và Vite dev server.
  serverPort: Number(process.env.SERVER_PORT) || 4311,
  webPort: Number(process.env.WEB_PORT) || 5311,
};
