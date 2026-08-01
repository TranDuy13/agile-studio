// Project mẫu `stale-demo` — project kiểm thử của cả Agile Studio, tự khởi tạo.
//
// Nó KHÔNG chặn gì cả: mọi project đều chạy được sinh tài liệu. Cái giữ chi phí trong tầm kiểm soát
// trong lúc còn issue mở là chế độ tiết kiệm bị ép bật (xem `DEV_LOCK_ECONOMY` trong economy.js),
// không phải một danh sách trắng project.
//
// Việc của tệp này chỉ còn hai: dựng project mẫu, và cho UI biết project nào là project mẫu để đánh
// dấu cho khác các project thật của người dùng.
//
// Vòng đời:
//   fixtures/demo-project/   nằm trong source, commit bình thường, KHÔNG có .git riêng
//        │  copy khi boot nếu thiếu
//        ▼
//   <dataDir>/demo/stale-demo/   bản chạy thật, repo_path của project trỏ vào đây
//
// Vì sao copy chứ không trỏ thẳng vào fixtures: agent chạy với --dangerously-skip-permissions và
// cwd là repo_path. Trỏ thẳng vào source nghĩa là một prompt hỏng có thể ghi vào cây làm việc của
// chính Agile Studio. Bản copy ngoài source thì hỏng cũng chỉ mất bản copy — xoá đi, boot sau tự
// dựng lại.
//
// KHÔNG có `git init` ở đây (chủ repo đã chốt): tính năng "tìm mục đã cũ" cần git nên nó sẽ báo
// "thư mục nguồn không phải repo git" trên project này. Đó là hành vi đúng và đã lường trước —
// ca 5 kiểm bằng repo git thật, không kiểm qua demo.
import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_DIR } from "../store/docgen.js";

export const DEMO_NAME = "stale-demo";
export const DEMO_DIR = join(DATA_DIR, "demo", DEMO_NAME);

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures", "demo-project");

const samePath = (a, b) =>
  String(a || "").replace(/[\\/]+$/, "").toLowerCase() === String(b || "").replace(/[\\/]+$/, "").toLowerCase();

function copyTree(from, to) {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const src = join(from, name), dst = join(to, name);
    if (statSync(src).isDirectory()) copyTree(src, dst);
    else copyFileSync(src, dst);
  }
}

// Thư mục có tệp nào không. "Có thư mục nhưng rỗng" phải tính là thiếu: đó là dấu vết của một lần
// xoá tay hoặc một lần copy dở.
function hasFiles(dir) {
  try { return readdirSync(dir).length > 0; } catch { return false; }
}

// Dựng lại bản chạy nếu thiếu. Không ghi đè tệp đã có: người dùng sửa src/reminders.js để thử ca
// "nguồn đã đổi" thì lần boot sau không được xoá mất thay đổi đó.
export function ensureDemoFiles() {
  if (hasFiles(DEMO_DIR)) return { created: false, path: DEMO_DIR };
  if (!existsSync(FIXTURES)) return { created: false, path: DEMO_DIR, error: `Thiếu ${FIXTURES}` };
  copyTree(FIXTURES, DEMO_DIR);
  return { created: true, path: DEMO_DIR };
}

// Gọi một lần lúc boot. Ba tình huống, và cả ba phải tự lành:
//   1. studio.json chưa có project nào       → tạo stale-demo
//   2. có stale-demo nhưng repo_path đã chết → trỏ lại vào DEMO_DIR (đường dẫn cũ nằm trong thư
//      mục temp của một phiên đã kết thúc, nên đây là tình huống thường gặp nhất)
//   3. docgen.json chưa có bộ tài liệu nào   → seed dữ liệu mẫu để có cái mà xem
export function ensureDemoProject(store, docgenStore) {
  const out = { files: ensureDemoFiles(), project: null, action: "kept", seeded: null };

  const found = store.listProjects().find((p) => p.name === DEMO_NAME);
  if (!found) {
    try {
      const r = store.addProject(DEMO_NAME, DEMO_DIR, { internal: true });
      out.project = store.getProject(r.lastInsertRowid);
      out.action = "created";
    } catch (e) {
      // Repo trùng đường dẫn với một project khác tên: giữ project đó, đừng tạo thêm.
      out.project = store.listProjects().find((p) => samePath(p.repo_path, DEMO_DIR)) || null;
      out.action = "conflict";
      out.error = String(e.message);
    }
  } else {
    out.project = found;
    if (!samePath(found.repo_path, DEMO_DIR) || !existsSync(found.repo_path)) {
      store.setProjectPath(found.id, DEMO_DIR);
      out.project = store.getProject(found.id);
      out.action = "repathed";
      out.from = found.repo_path;
    }
  }

  if (out.project && !docgenStore.listJobs(out.project.id).length) {
    // Chỉ seed khi trống trơn. Đã có bộ tài liệu nào rồi thì không chèn thêm: người dùng có thể đã
    // xoá dữ liệu mẫu có chủ ý, và tự mọc lại là hành vi khó chịu.
    out.seeded = "pending";
  }
  return out;
}

// ---- nhận dạng project mẫu -------------------------------------------------------------------
// Một định nghĩa duy nhất, dùng cho cả việc đánh dấu trên sidebar và việc bootstrap tự nhận ra
// project của chính nó. So cả tên lẫn đường dẫn: người dùng đổi tên được, mà bản chạy vẫn là nó.
export function isDemoProject(project) {
  if (!project) return false;
  return project.name === DEMO_NAME || samePath(project.repo_path, DEMO_DIR);
}

// Nhãn hiện trên UI. Đặt ở đây để một câu giải thích chỉ tồn tại một bản.
export const DEMO_BADGE = "mẫu";
export const DEMO_HINT = `Project kiểm thử đi kèm Agile Studio — một dịch vụ nhắc lịch ba tệp, do `
  + `Studio tự dựng trong ${DEMO_DIR}. Dùng để bấm thử mọi tính năng mà gần như không tốn token. `
  + `Xoá nội dung trong đó thoải mái: lần khởi động sau Studio dựng lại.`;

// Gắn cờ + đưa project mẫu xuống cuối danh sách. Sidebar vẽ một đường phân cách trước nó, nên nó
// không bị lẫn vào các project thật của người dùng.
export function markAndSortProjects(list) {
  const rows = (list || []).map((p) => (isDemoProject(p)
    ? { ...p, demo: true, demoBadge: DEMO_BADGE, demoHint: DEMO_HINT }
    : p));
  const real = rows.filter((p) => !p.demo);
  const demo = rows.filter((p) => p.demo);
  return real.concat(demo);
}
