// Log phiên agent theo từng bộ tài liệu — thứ ca 11 thiếu.
//
// Bài học của ca 11: server restart giữa lúc viết, job về `error` với đúng một câu "Server khởi
// động lại khi đang viết". Mọi thứ Claude đã làm trước đó chỉ nằm trong RAM (`job.write.activity`
// giữ được một dòng duy nhất) nên không còn gì để soi. Vì vậy log ở đây:
//
//   * ghi ra ĐĨA ngay khi phát sinh, dạng JSONL append-only → restart không mất
//   * giữ `detail` nguyên vẹn (tham số tool, toàn văn Claude nói, stderr, prompt) → dò được nguyên nhân
//   * mỗi dòng mang `session` → chạy song song per-doc/per-section vẫn tách được ai làm gì
//
// Nằm trong docgen-work (không phải docgen.json): log là dữ liệu chỉ-thêm và to, trộn vào JSON
// state sẽ làm mỗi lần persist ghi lại cả tệp.
//
// ⚠ Log là TỆP CỤC BỘ, kể cả khi phần còn lại của Studio lưu vào database (nhánh `local-work`). Nó
// KHÔNG đi theo DB. Hệ quả phải xử lý tử tế, không được im lặng:
//   * lượt chạy trên máy A, mở xem ở máy B  → máy B không có tệp
//   * người dùng xoá docgen-work            → tệp mất, job vẫn còn trong DB
//   * dataDir khác nhau giữa hai máy        → như trên
// Vì vậy mỗi lượt chạy đóng dấu `host` + đường dẫn tệp vào job, và `logState()` phân biệt được
// "chưa chạy lần nào" với "đã chạy nhưng log không có ở máy này" — hai thứ này mà nói chung một câu
// thì người dùng sẽ tưởng tính năng hỏng.
import { appendFileSync, existsSync, mkdirSync, openSync, readSync, closeSync, statSync,
  renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { hostname } from "node:os";
import { WORK_DIR } from "../store/docgen.js";

const ROTATE_BYTES = 24 * 1024 * 1024;   // quá mức này thì đổi tên thành .1 và mở tệp mới
const TAIL_BYTES = 2 * 1024 * 1024;      // đọc lại từ đĩa thì chỉ lấy đuôi
const MEM_ENTRIES = 2000;                // ring trong RAM cho realtime, đĩa mới là bản đầy đủ
const MEM_JOBS = 8;                      // số job giữ cache; quá thì bỏ job ít dùng nhất

export function logDirFor(jobId) {
  const dir = join(WORK_DIR, String(jobId));
  mkdirSync(dir, { recursive: true });
  return dir;
}
export const logFileFor = (jobId) => join(logDirFor(jobId), "run.log");

// jobId -> { entries[], seq, run, touched }
const mem = new Map();

function cacheOf(jobId) {
  let c = mem.get(jobId);
  if (!c) {
    c = { entries: null, seq: 0, run: null, touched: Date.now() };
    mem.set(jobId, c);
    if (mem.size > MEM_JOBS) {
      const oldest = [...mem.entries()].sort((a, b) => a[1].touched - b[1].touched)[0];
      if (oldest && oldest[0] !== jobId) mem.delete(oldest[0]);
    }
  }
  c.touched = Date.now();
  return c;
}

// Đọc đuôi tệp và parse thành entry. Dùng khi UI mở một job mà tiến trình này chưa chạy lượt nào
// cho nó — đúng tình huống sau restart.
function readTail(jobId) {
  const file = logFileFor(jobId);
  if (!existsSync(file)) return [];
  let fd;
  try {
    const size = statSync(file).size;
    const from = Math.max(0, size - TAIL_BYTES);
    const len = size - from;
    if (len <= 0) return [];
    const buf = Buffer.allocUnsafe(len);
    fd = openSync(file, "r");
    readSync(fd, buf, 0, len, from);
    const text = buf.toString("utf8");
    // Cắt ở dòng đầu tiên nếu đọc từ giữa tệp: dòng đó gần như chắc chắn bị đứt.
    const lines = text.split("\n").slice(from > 0 ? 1 : 0);
    const out = [];
    for (const line of lines) {
      const s = line.trim();
      if (!s) continue;
      try { out.push(JSON.parse(s)); } catch { /* dòng đứt do ghi song song — bỏ */ }
    }
    return out;
  } catch { return []; }
  finally { if (fd !== undefined) try { closeSync(fd); } catch { /* đã đóng */ } }
}

function ensureEntries(jobId) {
  const c = cacheOf(jobId);
  if (c.entries) return c;
  const disk = readTail(jobId);
  c.entries = disk.slice(-MEM_ENTRIES);
  c.seq = Math.max(0, ...c.entries.map((e) => Number(e.seq) || 0));
  return c;
}

function rotateIfBig(jobId) {
  const file = logFileFor(jobId);
  try {
    if (!existsSync(file) || statSync(file).size < ROTATE_BYTES) return;
    try { rmSync(file + ".1", { force: true }); } catch { /* chưa có */ }
    renameSync(file, file + ".1");
  } catch { /* rotate lỗi thì cứ ghi tiếp, thà log to hơn là mất log */ }
}

export const HOST = hostname();

// Mở một lượt chạy mới. runId đi kèm mọi dòng của lượt đó nên UI lọc được "lượt gần nhất".
// Trả về cả `host` và `file` để nơi gọi đóng dấu vào job — đó là thứ duy nhất cho biết log của lượt
// này đáng ra nằm ở máy nào, khi sau này mở xem trên một máy không có tệp.
export function beginRun(jobId, { stage, engine = null, note = "" } = {}) {
  const c = cacheOf(jobId);
  const runId = `${stage}-${Date.now().toString(36)}`;
  c.run = runId;
  rotateIfBig(jobId);
  log(jobId, { stage, kind: "run", text: note || `▶ bắt đầu ${stage}${engine ? ` · ${engine}` : ""}`,
    detail: `runId: ${runId}\nstage: ${stage}${engine ? `\nengine: ${engine}` : ""}\n`
      + `máy:   ${HOST}\ntệp log: ${logFileFor(jobId)}\n`
      + `bắt đầu: ${new Date().toISOString()}` });
  return { runId, host: HOST, file: logFileFor(jobId) };
}

export function endRun(jobId, { stage, ok, text, detail } = {}) {
  log(jobId, { stage, kind: ok ? "run" : "run-error",
    text: text || (ok ? "■ kết thúc" : "■ kết thúc có lỗi"), detail });
  const c = mem.get(jobId);
  if (c) c.run = null;
}

// Ghi một dòng. Trả về entry đã hoàn chỉnh để route broadcast đúng thứ vừa lưu, không phải bản khác.
export function log(jobId, entry) {
  const c = ensureEntries(jobId);
  const row = {
    seq: ++c.seq,
    t: Date.now(),
    run: entry.run || c.run || null,
    stage: entry.stage || null,
    session: entry.session || null,
    kind: entry.kind || "info",
    text: String(entry.text ?? "").slice(0, 400),
    ...(entry.detail ? { detail: String(entry.detail) } : {}),
    ...(entry.code !== undefined ? { code: entry.code } : {}),
    ...(entry.tokens ? { tokens: entry.tokens } : {}),
  };
  c.entries.push(row);
  if (c.entries.length > MEM_ENTRIES) c.entries.splice(0, c.entries.length - MEM_ENTRIES);
  // appendFileSync đồng bộ là cố ý: một dòng ~1KB, và log mất vì tiến trình chết đúng lúc ghi
  // chính là lỗi mà tệp này ra đời để sửa.
  try { appendFileSync(logFileFor(jobId), JSON.stringify(row) + "\n"); }
  catch (e) { console.error("[docgen] không ghi được run.log: " + e.message); }
  return row;
}

// Vì sao không có dòng nào — thứ quyết định UI hiện câu gì.
//
// `ran` là dấu vết trong job (DB hoặc docgen.json) rằng đã từng có lượt chạy. Ghép nó với "tệp có
// tồn tại không" và "tệp do máy nào ghi" là ra đủ bốn trạng thái cần phân biệt:
//
//   never     chưa chạy lần nào              → "chưa có log" là đúng
//   ok        có tệp, đọc được
//   other-host đã chạy, tệp không có ở đây, và job nói lượt đó chạy ở máy khác
//   missing   đã chạy, tệp không có, cùng máy → bị xoá (hoặc dataDir đã đổi)
//   unreadable tệp có mà không đọc được       → quyền, khoá, hỏng
export function logState(jobId, { ran = false, ranHost = null } = {}) {
  const file = logFileFor(jobId);
  const here = HOST;
  let exists = false, bytes = 0, readable = true;
  try { const st = statSync(file); exists = st.isFile(); bytes = st.size; }
  catch (e) { exists = false; if (e.code && e.code !== "ENOENT") readable = false; }

  if (exists) {
    // Có tệp nhưng mở không được: đừng báo "chưa có log", đó là câu trả lời sai.
    try { closeSync(openSync(file, "r")); } catch { readable = false; }
    if (!readable) return { state: "unreadable", file, host: here, ranHost, bytes };
    return { state: "ok", file, host: here, ranHost, bytes };
  }
  if (!ran) return { state: "never", file, host: here, ranHost: null, bytes: 0 };
  if (ranHost && ranHost !== here) return { state: "other-host", file, host: here, ranHost, bytes: 0 };
  return { state: "missing", file, host: here, ranHost, bytes: 0 };
}

// Đọc cho UI. `after` là seq của dòng cuối UI đã có → lần gọi sau chỉ lấy phần mới.
export function readLog(jobId, { after = 0, limit = 400, session = null, kind = null, run = null } = {}) {
  const c = ensureEntries(jobId);
  let rows = c.entries;
  if (after > 0) rows = rows.filter((e) => e.seq > after);
  if (run) rows = rows.filter((e) => e.run === run);
  if (session) rows = rows.filter((e) => e.session === session);
  if (kind) {
    // "problem" là bộ lọc người dùng thật sự cần: mọi thứ khiến một lượt viết dở dang.
    const want = kind === "problem"
      ? new Set(["stderr", "tool_error", "exit", "run-error", "error"])
      : new Set(String(kind).split(",").map((s) => s.trim()).filter(Boolean));
    rows = rows.filter((e) => want.has(e.kind) || (kind === "problem" && e.code));
  }
  const total = rows.length;
  return {
    entries: rows.slice(-limit),
    total,
    lastSeq: c.entries.length ? c.entries.at(-1).seq : 0,
    runs: [...new Set(c.entries.map((e) => e.run).filter(Boolean))].slice(-12),
    sessions: [...new Set(c.entries.map((e) => e.session).filter(Boolean))].slice(-24),
    file: logFileFor(jobId),
    bytes: (() => { try { return statSync(logFileFor(jobId)).size; } catch { return 0; } })(),
  };
}

// Bản .log tải về: văn bản thuần, một dòng một event, detail thụt lề. Đọc bằng mắt trong Notepad
// được — đó là mục đích, không phải để máy parse lại.
export function renderLogText(jobId, { session = null, run = null } = {}) {
  const { entries } = readLog(jobId, { limit: MEM_ENTRIES, session, run });
  const head = [
    `# Log phiên agent — bộ tài liệu ${jobId}`,
    `# xuất lúc ${new Date().toISOString()} · ${entries.length} dòng`,
    `# tệp gốc: ${logFileFor(jobId)}`,
    "",
  ];
  const body = entries.map((e) => {
    const ts = new Date(e.t).toISOString().slice(11, 23);
    const who = [e.stage, e.session].filter(Boolean).join("/");
    const line = `[${ts}] ${String(e.kind).padEnd(11)} ${who ? who + " " : ""}${e.text}`;
    if (!e.detail) return line;
    return line + "\n" + e.detail.split("\n").map((l) => "    │ " + l).join("\n");
  });
  return head.concat(body).join("\n") + "\n";
}

export function clearLog(jobId) {
  mem.delete(jobId);
  for (const f of [logFileFor(jobId), logFileFor(jobId) + ".1"])
    try { rmSync(f, { force: true }); } catch { /* không có thì thôi */ }
}

// Dòng cuối cùng còn ý nghĩa trước khi tiến trình chết — dùng để giải thích một job bị ngắt
// (ca 11) thay vì chỉ nói "server đã restart".
export function lastMeaningful(jobId, n = 6) {
  const c = ensureEntries(jobId);
  return c.entries.filter((e) => e.kind !== "run").slice(-n);
}
