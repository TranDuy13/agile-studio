// Making sure `spawn("claude")` can actually find the CLI.
//
// runner.js on this branch spawns the bare name with no shell and no lookup, so when the Claude
// CLI is installed somewhere that is on the user's interactive PATH but not on the PATH the
// server process inherited (the native installer's ~/.local/bin is the common case), every run
// dies with ENOENT and nothing explains why.
//
// The fix that belongs in runner.js is a resolver; that file is outside this feature's touch
// budget, so instead this module resolves a directly spawnable binary and prepends its folder to
// process.env.PATH. runClaude passes { ...process.env } to spawn, so the lookup then succeeds
// without a single line changing in runner.js. It is a no-op when `claude` already resolves.
import { existsSync, statSync } from "node:fs";
import { join, delimiter } from "node:path";
import { homedir } from "node:os";

const WIN = process.platform === "win32";
// Only names Windows CreateProcess / POSIX exec can run directly. A .cmd or .ps1 shim cannot be
// spawned without a shell, and runClaude does not use one — so those do not count as found.
const NAMES = WIN ? ["claude.exe"] : ["claude"];

function candidateDirs() {
  const home = homedir();
  const dirs = (process.env.PATH || "").split(delimiter).filter(Boolean);
  const extra = WIN
    ? [join(home, ".local", "bin"),
       join(process.env.LOCALAPPDATA || join(home, "AppData", "Local"), "Programs", "claude"),
       join(process.env.LOCALAPPDATA || join(home, "AppData", "Local"), "claude", "bin")]
    : [join(home, ".local", "bin"), "/usr/local/bin", "/opt/homebrew/bin", join(home, "bin")];
  return [...dirs, ...extra];
}

function findIn(dir) {
  for (const name of NAMES) {
    const full = join(dir, name);
    try { if (existsSync(full) && statSync(full).isFile()) return full; } catch { /* unreadable dir */ }
  }
  return null;
}

let cached = null;

// Returns { ok, path, addedToPath, hint }. Result is cached: the answer cannot change while the
// server runs, and this sits on the hot path of every survey.
export function ensureClaudeOnPath() {
  if (cached) return cached;
  const onPath = (process.env.PATH || "").split(delimiter).filter(Boolean);
  for (const dir of onPath) {
    const hit = findIn(dir);
    if (hit) return (cached = { ok: true, path: hit, addedToPath: false });
  }
  for (const dir of candidateDirs()) {
    const hit = findIn(dir);
    if (hit) {
      process.env.PATH = dir + delimiter + (process.env.PATH || "");
      console.log(`[docgen] tìm thấy Claude CLI ở ${hit} — đã thêm thư mục này vào PATH của tiến trình server.`);
      return (cached = { ok: true, path: hit, addedToPath: true });
    }
  }
  return (cached = {
    ok: false, path: null, addedToPath: false,
    hint: WIN
      ? "Không tìm thấy claude.exe. Cài Claude Code bằng bộ cài native, hoặc thêm thư mục chứa claude.exe "
        + "(thường là %USERPROFILE%\\.local\\bin) vào PATH rồi khởi động lại Agile Studio. "
        + "Bản cài qua npm chỉ có claude.cmd nên tiến trình nền không gọi trực tiếp được."
      : "Không tìm thấy lệnh claude trong PATH. Cài Claude Code hoặc thêm thư mục chứa nó vào PATH "
        + "rồi khởi động lại Agile Studio.",
  });
}

// Turn a raw spawn failure into something a user can act on.
export function explainSpawnError(err) {
  const msg = String(err?.message || err);
  if (!/ENOENT/.test(msg)) return msg;
  return "Không chạy được Claude CLI (ENOENT). " + (ensureClaudeOnPath().hint
    || "Kiểm tra lại lệnh `claude` rồi khởi động lại Agile Studio.");
}
