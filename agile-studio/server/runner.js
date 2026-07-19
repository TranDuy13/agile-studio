// Chạy Claude Code dưới nền cho một node role, parse stream-json để lấy "đang làm gì".
import { spawn } from "node:child_process";
import { existsSync, readdirSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { defaultConfigDir } from "./accounts.js";
import { claudeSpawn } from "./claudeBin.js";

// Bỏ mã màu ANSI (\x1b[..m) khỏi output để log hiển thị sạch, không tràn/đè.
const stripAnsi = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, "");

// Kill claude + TOÀN BỘ tiến trình con (build/tsc/...) bằng cách kill cả process group,
// và SIGKILL ép chết nếu SIGTERM không ăn (tránh treo ở "Đang dừng…").
export function killChild(child) {
  if (!child || child.killed) return;
  const grp = () => { try { process.kill(-child.pid, "SIGTERM"); return true; } catch { return false; } };
  if (!grp()) { try { child.kill("SIGTERM"); } catch {} }
  setTimeout(() => {
    try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch {} }
  }, 3000);
}

// Copy transcript hội thoại của 1 session từ config dir account này sang account khác,
// để --resume trên account mới vẫn giữ NGUYÊN ngữ cảnh (switch account như VSCode nhưng khác config dir).
// Transcript ở <configDir>/projects/<cwd-mã-hoá>/<sessionId>.jsonl — tìm theo sessionId ở mọi project folder.
export function copySessionTranscript(fromDir, toDir, sessionId) {
  try {
    const fromProjects = join(fromDir, "projects");
    if (!existsSync(fromProjects)) return false;
    for (const folder of readdirSync(fromProjects)) {
      const src = join(fromProjects, folder, `${sessionId}.jsonl`);
      if (existsSync(src)) {
        const destDir = join(toDir, "projects", folder);
        mkdirSync(destDir, { recursive: true });
        copyFileSync(src, join(destDir, `${sessionId}.jsonl`));
        return true;
      }
    }
  } catch { /* best-effort */ }
  return false;
}

// Map subagent -> role node id
export const ROLE_ORDER = ["pm", "ba", "da", "dev", "qc", "po"];
export const ROLE_META = {
  pm:  { agent: "agile-pm",  name: "Product Manager",  emoji: "🎯" },
  ba:  { agent: "agile-ba",  name: "Business Analyst",  emoji: "📋" },
  da:  { agent: "agile-da",  name: "Solution Architect", emoji: "🏗️" },
  dev: { agent: "agile-dev", name: "Developer",         emoji: "💻" },
  qc:  { agent: "agile-qc",  name: "QC / Tester",       emoji: "🔍" },
  po:  { agent: "agile-po",  name: "Product Owner",     emoji: "✅" },
};

// Diễn giải một event stream-json của Claude Code thành activity người đọc được.
function describe(ev) {
  if (ev.type === "assistant" && ev.message?.content) {
    for (const b of ev.message.content) {
      if (b.type === "text" && b.text?.trim()) return { kind: "text", text: b.text.trim().slice(0, 400) };
      if (b.type === "tool_use") {
        const t = b.name, i = b.input || {};
        if (t === "Read")  return { kind: "tool", text: `📖 đọc ${i.file_path || i.path || ""}` };
        if (t === "Write") return { kind: "tool", text: `✍️ viết ${i.file_path || i.path || ""}` };
        if (t === "Edit")  return { kind: "tool", text: `✏️ sửa ${i.file_path || i.path || ""}` };
        if (t === "Bash")  return { kind: "tool", text: `⚙️ chạy: ${(i.command || "").slice(0, 120)}` };
        if (t === "Glob" || t === "Grep") return { kind: "tool", text: `🔎 tìm ${i.pattern || ""}` };
        if (t === "Task")  return { kind: "tool", text: `🤝 giao subagent: ${i.subagent_type || i.description || ""}` };
        return { kind: "tool", text: `🔧 ${t}` };
      }
    }
  }
  if (ev.type === "result") {
    return { kind: "result", text: ev.subtype === "success" ? "✓ hoàn tất" : `✖ ${ev.subtype}`,
             usage: ev.usage, cost: ev.total_cost_usd };
  }
  return null;
}

// Chạy 1 prompt qua Claude Code trong cwd (repo project), với configDir account đã chọn.
// onEvent nhận {kind, text, ...} realtime. onSpawn nhận child để orchestrator kill khi tạm dừng.
export function runClaude({ prompt, cwd, configDir, model, maxBudgetUsd, allowCommands = true, sessionId, resumeSessionId, onEvent, onSpawn }) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    // Chỉ set CLAUDE_CONFIG_DIR khi account KHÁC dir mặc định. Nếu set cho dir mặc định,
    // claude tìm credential Keychain theo tên có hash (Claude Code-credentials-<hash>) — không tồn tại
    // vì `/login` bình thường lưu ở tên thuần "Claude Code-credentials" → báo "Not logged in".
    if (configDir && configDir !== defaultConfigDir()) env.CLAUDE_CONFIG_DIR = configDir;
    // -p: print mode (headless). --output-format stream-json để parse realtime.
    // allowCommands: cho agent chạy lệnh (build/test/git) — headless không ai bấm duyệt nên phải bypass.
    const args = ["-p", prompt, "--output-format", "stream-json", "--verbose",
                  ...(allowCommands ? ["--dangerously-skip-permissions"] : ["--permission-mode", "acceptEdits"])];
    // Nối hội thoại (giống Claude Code VSCode): resume session cũ, hoặc gắn session-id để nối về sau.
    if (resumeSessionId) args.push("--resume", resumeSessionId);
    else if (sessionId) args.push("--session-id", sessionId);
    if (model) args.push("--model", model); // model do người dùng cấu hình (alias hoặc full id)
    if (maxBudgetUsd > 0) args.push("--max-budget-usd", String(maxBudgetUsd)); // trần chi phí/role (tiết kiệm)
    // Resolve Claude CLI (fix ENOENT). detached để kill cả cây con; .cmd trên Windows cần shell.
    const { bin, useShell } = claudeSpawn();
    const child = spawn(bin, args, { cwd, env, detached: !useShell, shell: useShell });
    onSpawn?.(child);

    let buf = "";
    let lastResult = null;

    child.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const ev = JSON.parse(line);
          const d = describe(ev);
          if (d) {
            if (d.kind === "result") lastResult = d;
            onEvent(d);
          }
        } catch { /* dòng không phải json, bỏ qua */ }
      }
    });

    let stderr = "";
    child.stderr.on("data", (c) => (stderr += c.toString()));

    child.on("error", (e) => reject(e));
    child.on("close", (code) => {
      if (code === 0) resolve({ result: lastResult });
      else reject(new Error(`claude exited ${code}: ${stripAnsi(stderr).slice(0, 400)}`));
    });
  });
}

// Phiên bản "trực tiếp" (giống Claude Code VSCode): giữ 1 tiến trình sống, gửi nhiều user message
// qua stdin (stream-json), giữ nguyên ngữ cảnh. Mỗi lượt kết thúc bằng event result -> onTurnEnd.
// Trả về { promise, send(text), finish(), child }. Gọi finish() để đóng stdin -> tiến trình thoát.
export function runClaudeStream({ cwd, configDir, model, allowCommands = true, sessionId, resumeSessionId, onEvent, onTurnEnd, onSpawn }) {
  const env = { ...process.env };
  if (configDir && configDir !== defaultConfigDir()) env.CLAUDE_CONFIG_DIR = configDir;
  const args = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
                ...(allowCommands ? ["--dangerously-skip-permissions"] : ["--permission-mode", "acceptEdits"])];
  if (resumeSessionId) args.push("--resume", resumeSessionId);
  else if (sessionId) args.push("--session-id", sessionId);
  if (model) args.push("--model", model);
  // Resolve Claude CLI (fix ENOENT). Prompt gửi qua stdin nên .cmd+shell an toàn.
  const { bin, useShell } = claudeSpawn();
  const child = spawn(bin, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"], detached: !useShell, shell: useShell });
  onSpawn?.(child);

  let buf = "", stderr = "", lastResult = null;
  child.stdout.on("data", (chunk) => {
    buf += chunk.toString();
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line) continue;
      let ev; try { ev = JSON.parse(line); } catch { continue; }
      const d = describe(ev);
      if (!d) continue;
      if (d.kind === "result") { lastResult = d; onEvent?.(d); onTurnEnd?.(d); }
      else onEvent?.(d);
    }
  });
  child.stderr.on("data", (c) => (stderr += c.toString()));

  const promise = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve({ result: lastResult })
      : reject(new Error(`claude exited ${code}: ${stripAnsi(stderr).slice(0, 400)}`)));
  });
  const send = (text) => {
    try { child.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } }) + "\n"); } catch {}
  };
  const finish = () => { try { child.stdin.end(); } catch {} };
  return { promise, send, finish, child };
}
