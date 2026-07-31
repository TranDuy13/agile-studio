// Gom mọi tệp test trong thư mục này thành một lệnh: `yarn test`.
//
// Vì sao tự dò tệp chứ không liệt kê tên: bộ test lớn dần theo từng feature (D1, D2, …) và mỗi
// feature làm ở một nhánh riêng. Nếu runner giữ danh sách tên tệp thì hai nhánh cùng thêm test là
// hai lần sửa chung một dòng — xung đột merge không cần thiết. Thả tệp `*.mjs` vào đây là đủ.
//
// Hợp đồng của một tệp test: tự in kết quả, `process.exit(0)` khi sạch, khác 0 khi có ca hỏng.
// Cả ba tệp `d21-*.mjs` đã theo đúng hợp đồng này.
//
// Chạy TUẦN TỰ, không song song: tệp test tầng HTTP mở cổng cố định và ghi vào
// `~/.agile-studio/studio.json`. Chạy chồng nhau là tranh cổng và tranh tệp.
import { readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SELF = "run-all.mjs";

const files = readdirSync(HERE)
  .filter((f) => f.endsWith(".mjs") && f !== SELF)
  .sort();

if (files.length === 0) {
  // Chưa có tệp test nào là trạng thái hợp lệ (nhánh chưa mang feature nào có test về).
  // Không dựng nó thành lỗi đỏ, nhưng phải nói to để không ai tưởng "xanh = đã kiểm".
  console.log("⚠️  tests/: chưa có tệp test nào — bỏ qua.");
  process.exit(0);
}

console.log(`Chạy ${files.length} tệp test: ${files.join(", ")}\n`);

const failed = [];
for (const f of files) {
  console.log(`\n${"─".repeat(70)}\n▶ ${f}\n${"─".repeat(70)}`);
  const code = await new Promise((resolve) => {
    // cwd = thư mục gốc của app: một số bài test dựng đường dẫn từ process.cwd().
    const child = spawn(process.execPath, [join(HERE, f)], { cwd: join(HERE, ".."), stdio: "inherit" });
    child.on("close", (c, signal) => resolve(signal ? 1 : c ?? 1));
    child.on("error", (e) => { console.error(`không chạy được ${f}: ${e.message}`); resolve(1); });
  });
  if (code !== 0) failed.push(`${f} (exit ${code})`);
}

console.log(`\n${"═".repeat(70)}`);
if (failed.length === 0) {
  console.log(`✅ ${files.length}/${files.length} tệp test đạt`);
  process.exit(0);
}
console.log(`❌ ${failed.length}/${files.length} tệp test hỏng:\n   ${failed.join("\n   ")}`);
process.exit(1);
