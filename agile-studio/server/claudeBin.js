// Resolve đường dẫn Claude CLI để spawn được trên MỌI HĐH (fix `spawn claude ENOENT`).
// Thứ tự: 1) env CLAUDE_BIN/CLAUDE_CLI_PATH  2) PATH (where/which)  3) vị trí cài thường gặp
//         (npm global, native installer, binary kèm VSCode extension).
// Trên Windows: file .cmd/.bat cần spawn với { shell: true } (Node không chạy trực tiếp được).
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { config } from "./config.js";

let cached = null; // { bin, useShell }

function fromPath() {
  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    const out = execFileSync(cmd, ["claude"], { encoding: "utf8" });
    const first = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    return first && existsSync(first) ? first : null;
  } catch { return null; }
}

// Binary kèm VSCode extension: ~/.vscode/extensions/anthropic.claude-code-<ver>-<plat>/resources/native-binary/claude(.exe)
function fromVscodeExtension() {
  try {
    const extRoot = join(homedir(), ".vscode", "extensions");
    if (!existsSync(extRoot)) return null;
    const dirs = readdirSync(extRoot)
      .filter((d) => d.startsWith("anthropic.claude-code-"))
      .sort()             // tên có version -> sort tăng dần
      .reverse();         // lấy bản mới nhất trước
    for (const d of dirs) {
      for (const name of ["claude.exe", "claude"]) {
        const p = join(extRoot, d, "resources", "native-binary", name);
        if (existsSync(p)) return p;
      }
    }
  } catch { /* best-effort */ }
  return null;
}

function knownLocations() {
  const home = homedir();
  const list = [];
  if (process.env.APPDATA) {                        // npm global trên Windows
    list.push(join(process.env.APPDATA, "npm", "claude.cmd"));
    list.push(join(process.env.APPDATA, "npm", "claude"));
  }
  list.push(join(home, ".claude", "local", "claude"));       // native installer
  list.push(join(home, ".claude", "local", "claude.exe"));
  list.push("/usr/local/bin/claude", "/opt/homebrew/bin/claude"); // macOS/Linux thường gặp
  const vsc = fromVscodeExtension();
  if (vsc) list.push(vsc);
  return list.filter((p) => existsSync(p));
}

function setCache(bin) {
  const useShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(bin);
  cached = { bin, useShell };
  return cached;
}

// Trả về đường dẫn tuyệt đối tới Claude CLI, hoặc ném lỗi rõ ràng nếu không tìm thấy.
export function resolveClaudeBin() {
  if (cached) return cached.bin;
  if (config.claudeBin && existsSync(config.claudeBin)) return setCache(config.claudeBin).bin; // 1) env
  const p = fromPath();                    if (p) return setCache(p).bin;                       // 2) PATH
  const [k] = knownLocations();            if (k) return setCache(k).bin;                       // 3) known
  throw new Error(
    "Không tìm thấy Claude CLI. Cài Claude Code, thêm `claude` vào PATH, " +
    "hoặc đặt CLAUDE_BIN trong .env trỏ tới claude(.exe/.cmd)."
  );
}

// Tiện ích cho spawn: { bin, useShell }. useShell=true khi target là .cmd/.bat trên Windows.
export function claudeSpawn() {
  resolveClaudeBin();
  return cached; // { bin, useShell }
}
