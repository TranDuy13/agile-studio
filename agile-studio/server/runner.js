// Chạy Claude Code dưới nền cho một node role, parse stream-json để lấy "đang làm gì".
import { spawn } from "node:child_process";
import { existsSync, readdirSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { defaultConfigDir } from "./accounts.js";
import { claudeSpawn } from "./claudeBin.js";

// Bỏ mã màu ANSI (\x1b[..m) khỏi output để log hiển thị sạch, không tràn/đè.
const stripAnsi = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, "");

// Kill claude and its WHOLE child tree (build/tsc/...) so the app doesn't hang at "stopping".
export function killChild(child) {
  if (!child || child.killed) return;
  if (process.platform === "win32") {
    // Windows has no POSIX process groups; and when spawned through a shell (.cmd) the child
    // is cmd.exe with claude + build/tsc as grandchildren, so child.kill() reaps only cmd and
    // leaves the tree alive. taskkill /T kills the whole tree by PID, /F forces it.
    try { spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"]); }
    catch { try { child.kill(); } catch {} }
    return;
  }
  // POSIX: kill the whole process group (detached => negative pid = group), SIGKILL if SIGTERM is ignored.
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
//
// `text` là dòng một câu cho thanh trạng thái và LUÔN ngắn — mọi chỗ đang dùng nó (node role,
// thẻ session) trông đợi như vậy. Khi gọi với verbose, thêm `detail`: tham số tool nguyên vẹn,
// toàn văn phần Claude nói, kết quả tool trả về. Đó là thứ duy nhất trả lời được "vì sao vướng",
// nên nó phải nằm ngoài `text` chứ không phải cắt bớt `text`.
const MAX_DETAIL = 8000;      // đủ cho một lệnh Bash dài hoặc một traceback, không đủ để phình log
const cut = (s, n = MAX_DETAIL) => {
  const t = String(s ?? "");
  return t.length > n ? t.slice(0, n) + `\n… (cắt bớt ${t.length - n} ký tự)` : t;
};

// Tham số tool, JSON hoá gọn. Nội dung Write có thể là cả một tệp nên cắt riêng, sớm hơn.
function describeArgs(input) {
  const i = input || {};
  const out = {};
  for (const [k, v] of Object.entries(i)) {
    if (typeof v === "string") out[k] = cut(v, k === "content" || k === "new_string" || k === "old_string" ? 2000 : 4000);
    else out[k] = v;
  }
  return out;
}

// Nội dung một tool_result: có thể là chuỗi, có thể là mảng khối text/image.
function resultText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((c) => (typeof c === "string" ? c : c?.type === "text" ? c.text || "" : `[${c?.type || "?"}]`))
    .join("\n");
}

// Export để kiểm thử được bằng event stream-json ghi lại: đây là chỗ dễ vỡ nhất khi Claude Code
// đổi khuôn dạng, mà chạy thật để kiểm thì tốn token.
export { describe as describeEvent };
function describe(ev, verbose = false) {
  if (ev.type === "assistant" && ev.message?.content) {
    for (const b of ev.message.content) {
      if (b.type === "text" && b.text?.trim()) {
        const full = b.text.trim();
        return { kind: "text", text: full.slice(0, 400), ...(verbose ? { detail: cut(full) } : {}) };
      }
      if (b.type === "tool_use") {
        const t = b.name, i = b.input || {};
        const extra = verbose
          ? { tool: t, toolId: b.id, detail: cut(JSON.stringify(describeArgs(i), null, 1)) }
          : {};
        if (t === "Read")  return { kind: "tool", text: `📖 đọc ${i.file_path || i.path || ""}`, ...extra };
        if (t === "Write") return { kind: "tool", text: `✍️ viết ${i.file_path || i.path || ""}`, ...extra };
        if (t === "Edit")  return { kind: "tool", text: `✏️ sửa ${i.file_path || i.path || ""}`, ...extra };
        if (t === "Bash")  return { kind: "tool", text: `⚙️ chạy: ${(i.command || "").slice(0, 120)}`, ...extra };
        if (t === "Glob" || t === "Grep") return { kind: "tool", text: `🔎 tìm ${i.pattern || ""}`, ...extra };
        if (t === "Task")  return { kind: "tool", text: `🤝 giao subagent: ${i.subagent_type || i.description || ""}`, ...extra };
        return { kind: "tool", text: `🔧 ${t}`, ...extra };
      }
    }
  }
  // Kết quả tool quay về dưới dạng message của "user". Chỉ ai bật verbose mới nhận:
  // các màn hình cũ chỉ hiển thị một dòng "đang làm gì" nên thêm vào là làm nhiễu.
  if (verbose && ev.type === "user" && Array.isArray(ev.message?.content)) {
    for (const b of ev.message.content) {
      if (b.type !== "tool_result") continue;
      const body = resultText(b.content);
      const bad = !!b.is_error;
      const head = body.split("\n")[0].slice(0, 160);
      return { kind: bad ? "tool_error" : "tool_result", toolId: b.tool_use_id,
        text: `${bad ? "✖" : "↩"} ${head || (bad ? "tool báo lỗi" : "tool xong")}`, detail: cut(body) };
    }
  }
  if (ev.type === "result") {
    return { kind: "result", text: ev.subtype === "success" ? "✓ hoàn tất" : `✖ ${ev.subtype}`,
             usage: ev.usage, cost: ev.total_cost_usd,
             ...(verbose ? { detail: cut(JSON.stringify({ subtype: ev.subtype, usage: ev.usage,
               cost: ev.total_cost_usd, duration_ms: ev.duration_ms, is_error: ev.is_error }, null, 1)) } : {}) };
  }
  if (verbose && ev.type === "system") {
    return { kind: "system", text: `⚙ ${ev.subtype || "system"}`,
      detail: cut(JSON.stringify({ subtype: ev.subtype, session_id: ev.session_id, model: ev.model,
        tools: ev.tools, cwd: ev.cwd, permissionMode: ev.permissionMode }, null, 1)) };
  }
  return null;
}

// Chạy 1 prompt qua Claude Code trong cwd (repo project), với configDir account đã chọn.
// onEvent nhận {kind, text, ...} realtime. onSpawn nhận child để orchestrator kill khi tạm dừng.
// verbose: thêm `detail` vào mỗi event, và phát thêm kind "spawn"/"stderr"/"exit"/"tool_result"/
// "system". Mặc định TẮT vì các màn hình cũ chỉ hiển thị một dòng activity.
export function runClaude({ prompt, cwd, configDir, model, maxBudgetUsd, allowCommands = true, sessionId, resumeSessionId, verbose = false, onEvent, onSpawn }) {
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
    // Dòng lệnh thật đã spawn: khi CLI thoát ≠ 0 mà chưa in gì, đây là bằng chứng duy nhất còn lại.
    if (verbose) onEvent?.({ kind: "spawn", text: `▶ claude (pid ${child.pid})`,
      detail: cut([`cwd:     ${cwd}`, `model:   ${model || "(mặc định)"}`,
        `config:  ${env.CLAUDE_CONFIG_DIR || "(dir mặc định)"}`,
        `args:    ${args.map((a) => (a === prompt ? `<prompt ${prompt.length} ký tự>` : a)).join(" ")}`,
        "", "--- prompt ---", prompt].join("\n"), 60000) });

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
          const d = describe(ev, verbose);
          if (d) {
            if (d.kind === "result") lastResult = d;
            onEvent(d);
          }
        } catch {
          // Dòng không phải JSON: bình thường thì bỏ qua, nhưng khi đang soi lỗi thì chính nó
          // (usage limit, stack trace của CLI) là câu trả lời.
          if (verbose) onEvent?.({ kind: "stdout", text: stripAnsi(line).slice(0, 200), detail: cut(stripAnsi(line)) });
        }
      }
    });

    let stderr = "";
    child.stderr.on("data", (c) => {
      const s = c.toString();
      stderr += s;
      if (verbose) onEvent?.({ kind: "stderr", text: stripAnsi(s).trim().split("\n")[0].slice(0, 200),
        detail: cut(stripAnsi(s)) });
    });

    child.on("error", (e) => {
      if (verbose) onEvent?.({ kind: "exit", text: `✖ không spawn được: ${e.message}`, detail: cut(String(e.stack || e.message)) });
      reject(e);
    });
    child.on("close", (code) => {
      if (verbose) onEvent?.({ kind: "exit", text: code === 0 ? "■ phiên thoát 0" : `✖ phiên thoát ${code}`,
        code, detail: cut(stripAnsi(stderr) || "(CLI không in gì ra stderr)") });
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
