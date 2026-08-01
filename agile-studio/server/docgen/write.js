// The writing stage: turning an approved outline into IR, one section at a time.
//
// Three things make this file longer than "loop over sections and call the model":
//
//   * Three ways to run (Q9), switchable while the run is in flight. Switching must not lose a
//     single section that is already on disk, so the engine only decides how sessions are grouped
//     — the record of what is done lives in the store, never in the loop.
//   * The agent writes each section to its OWN FILE and we read it back. The session stream only
//     carries the first 400 characters of a text block (the D1 lesson), so parsing content out of
//     the stream is not an option; and a per-section file is what makes a killed session
//     resumable — whatever landed on disk counts.
//   * A file that parses beats a non-zero exit code. The CLI sometimes exits non-zero after the
//     answer is already written; treating that as failure would throw away work that is done.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { runClaude, killChild, copySessionTranscript } from "../runner.js";
import { ensureClaudeOnPath, explainSpawnError } from "./claudeBin.js";
import { WORK_DIR, docgenStore } from "../store/docgen.js";
import { toneById } from "./tones.js";
import { KIND_LABELS } from "./standards/vocab.js";
import { normalizeSection, sectionMetrics, jobMetrics, pagesOf } from "./ir.js";
import { economyOf, modelFor, capTargets } from "./economy.js";
import * as runlog from "./runlog.js";

const pexecFile = promisify(execFile);

export const ENGINES = ["per-doc", "single", "per-section"];
const PER_SECTION_POOL = 3;         // more parallel sessions than this only buys rate-limit errors
const SWEEP_MS = 1100;
const MAX_TRANSIENT_RETRIES = 1;    // one retry per session for a spawn that produced nothing

// A document key can be namespaced ("arc42:sad") for a custom set, and ":" is not a legal Windows
// filename character — so the key is flattened for the path and never for the store.
const safeKey = (k) => String(k).replace(/[^a-zA-Z0-9._-]+/g, "_");

export function irDirFor(jobId) {
  const dir = join(WORK_DIR, String(jobId), "ir");
  mkdirSync(dir, { recursive: true });
  return dir;
}
export function irFileFor(jobId, docKey, num) {
  const dir = join(irDirFor(jobId), safeKey(docKey));
  mkdirSync(dir, { recursive: true });
  return join(dir, `${String(num).replace(/[^0-9.]/g, "_")}.json`);
}

// Stamped into every source of every block, so Q21 can ask "did these files change since?".
export async function headCommit(repoPath) {
  try {
    const { stdout } = await pexecFile("git", ["rev-parse", "--short", "HEAD"],
      { cwd: repoPath, windowsHide: true });
    return stdout.trim();
  } catch { return ""; }
}

function readJsonFile(file) {
  let raw = readFileSync(file, "utf8").trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) raw = fence[1].trim();
  const a = raw.indexOf("{"), b = raw.lastIndexOf("}");
  if (a > 0 || b < raw.length - 1) raw = raw.slice(a, b + 1);
  return JSON.parse(raw);
}

// ---- the prompt ------------------------------------------------------------------------------

// Terms that must be spelled one way across the whole set (N5). D1 does not ship a glossary
// editor, so the default is derived from what the survey found and the user can override it on
// the job; either way the writing prompt receives one list, not two sources of truth.
export function glossaryFor(job) {
  const own = Array.isArray(job.meta?.glossary) ? job.meta.glossary.filter(Boolean).map(String) : [];
  if (own.length) return own.slice(0, 60);
  const st = job.facts?.stack || {};
  return [st.runtime, ...(st.languages || []), ...(st.frameworks || []), ...(st.datastores || [])]
    .filter(Boolean).map(String).slice(0, 30);
}

function acceptLine(accept) {
  if (!accept) return "không có điều kiện riêng";
  const bits = [];
  if (accept.minBlocks) bits.push(`tối thiểu ${accept.minBlocks} khối nội dung`);
  if (accept.mustHave?.length) bits.push(`bắt buộc có khối: ${accept.mustHave.join(", ")}`);
  if (accept.minSources) bits.push(`tối thiểu ${accept.minSources} nguồn khác nhau`);
  if (accept.noEmptyCells) bits.push("bảng không được có ô trống");
  return bits.join(" · ") || "không có điều kiện riêng";
}

function sectionSpec(t, jobId) {
  const s = t.section;
  const rel = irFileFor(jobId, t.docKey, s.num).replace(/\\/g, "/");
  const src = (s.sources || []).length ? (s.sources || []).join(", ") : "(khảo sát chưa gắn nguồn — tự tìm)";
  return [
    `### ${s.num} — ${s.title}`,
    `- kind: ${s.kind} — ${KIND_LABELS[s.kind] || ""}`,
    `- ý nghĩa mục theo chuẩn: ${s.hint || "(không có)"}`,
    `- điều kiện ĐẠT: ${acceptLine(s.accept)}`,
    `- nguồn khảo sát đã gắn: ${src}`,
    `- GHI RA TỆP: ${rel}`,
  ].join("\n");
}

// Bản prompt rút gọn cho chế độ tiết kiệm. Giữ đúng hai thứ quyết định luồng chạy được kiểm hay
// không: LƯỢC ĐỒ TỆP (agent phải ghi ra JSON đúng chỗ) và LUẬT VỀ NGUỒN (ca 2 kiểm khối có nguồn).
// Bỏ phần văn phong, quy ước khối và danh sách 9 loại khối — chúng chỉ đổi chất lượng văn.
function buildShortWritePrompt({ job, std, doc, targets }) {
  return `Bạn đang VIẾT NỘI DUNG cho tài liệu "${doc.title}" theo chuẩn ${std.standard || std.label}.
Thư mục hiện tại là mã nguồn thật. Đây là lượt chạy TIẾT KIỆM: viết NGẮN, mỗi mục 1–2 khối, đừng đọc
rộng — chỉ đọc đúng tệp cần cho mục đang viết.

Viết bằng TIẾNG VIỆT. Không đổi tên mục. Giữ nguyên tên định danh trong mã.

LUẬT VỀ NGUỒN — bắt buộc
Mỗi khối phải có "sources": [{ "file": "đường/dẫn/thật", "lines": [từ, đến] }] với đường dẫn tương đối
so với gốc repo và tồn tại thật. Khối không dẫn được về mã nguồn thì khai "assumption": true.

CÁC MỤC CẦN VIẾT
${targets.map((t) => sectionSpec(t, job.id)).join("\n\n")}

LƯỢC ĐỒ TỆP KẾT QUẢ (một tệp một mục, đúng JSON, không kèm văn bản nào khác)
{ "blocks": [ { "t": "p", "text": "…", "sources": [{ "file": "src/a.ts", "lines": [1, 20] }] } ] }
Loại khối dùng được: "p" (đoạn văn), "bullets" (kèm "items"), "table" (kèm "headers" và "rows").

CÁCH LÀM
1. Đọc đúng tệp cần cho mục đang viết, không đọc thêm.
2. Dùng công cụ Write ghi tệp kết quả ra ĐÚNG đường dẫn đã ghi ở trên, xong mục nào ghi ngay mục đó.
3. Không sửa bất kỳ tệp nào trong mã nguồn.

Xong tất cả thì trả lời đúng một dòng: WRITE_DONE`;
}

export function buildWritePrompt({ job, std, doc, targets, extraSources = [], eco = null }) {
  if (eco?.shortPrompt) return buildShortWritePrompt({ job, std, doc, targets });
  const tone = toneById(job.style?.tone);
  const glossary = glossaryFor(job);
  const facts = job.facts?.items || [];
  const stack = job.facts?.stack || null;

  const factLines = facts.length
    ? facts.map((f) => `- ${f.level === "warn" ? "⚠ " : ""}${f.text}`).join("\n")
    : "- (chưa có kết quả khảo sát — tự đọc mã nguồn ở mức tối thiểu cần thiết)";

  const stackLine = stack
    ? `${stack.runtime || "?"} · ${(stack.languages || []).join(", ")} · ${(stack.frameworks || []).join(", ")}`
      + `${(stack.datastores || []).length ? " · " + stack.datastores.join(", ") : ""}`
    : "(chưa biết)";

  return `Bạn đang VIẾT NỘI DUNG cho tài liệu "${doc.title}" thuộc bộ tài liệu theo chuẩn ${std.standard || std.label}.
Thư mục hiện tại là mã nguồn thật của sản phẩm. Không đoán: mọi khẳng định phải đọc được từ mã nguồn.

NGỮ CẢNH ĐÃ KHẢO SÁT (dùng lại, đừng đọc lại repo từ đầu)
- Stack: ${stackLine}
${factLines}
${extraSources.length ? "- Tài liệu tham chiếu được phép đọc:\n" + extraSources.map((e) => `  · ${e.path}`).join("\n") + "\n" : ""}
VĂN PHONG (chỉ áp cho mục kind=explanation và tutorial)
${tone.guidance}
Mục kind=reference: viết súc tích, nêu định danh trước, không mở bài.
Mục kind=howto: đánh số từng bước, mỗi bước một hành động kiểm chứng được.

LUẬT NGÔN NGỮ — quan trọng
1. Viết nội dung bằng TIẾNG VIỆT.
2. KHÔNG dịch tên mục và tên tài liệu của chuẩn, KHÔNG đổi tên mục. Tiêu đề mục do dàn ý quyết định.
3. KHÔNG dịch thuật ngữ kỹ thuật đã quen dùng nguyên bản: endpoint, commit, cache, queue, middleware,
   migration, alt text, raster, watermark… Giữ nguyên tên định danh trong mã (tên lớp, tên hàm, tên khoá).
4. Thuật ngữ phải dùng nhất quán một cách viết duy nhất trong cả bộ.${glossary.length ? `\n   Danh sách phải giữ nguyên cách viết: ${glossary.join(" · ")}` : ""}
5. Không nhắc tới trợ lý AI, tên tệp cấu hình agent, hay bất cứ dấu vết công cụ nào.

LUẬT VỀ NGUỒN — bắt buộc, không có ngoại lệ
Mỗi khối nội dung phải mang "sources": [{ "file": "đường/dẫn/thật", "lines": [từ, đến] }] —
đường dẫn TƯƠNG ĐỐI so với thư mục gốc của repo và phải tồn tại thật.
Khối nào không dẫn được về mã nguồn thì phải tự khai một trong hai:
  "assumption": true          — là suy luận của bạn, chưa kiểm chứng được
  "providedBy": "owner"       — là thông tin do chủ sản phẩm cung cấp, không có trong mã
Không cần điền "commit" — hệ thống tự đóng dấu.

CÁC MỤC CẦN VIẾT
${targets.map((t) => sectionSpec(t, job.id)).join("\n\n")}

LƯỢC ĐỒ TỆP KẾT QUẢ (một tệp cho một mục, đúng JSON, không kèm văn bản nào khác)
{
  "blocks": [
    { "t": "p",       "text": "một đoạn văn", "sources": [{ "file": "src/a.ts", "lines": [10, 42] }] },
    { "t": "bullets", "items": ["…", "…"], "sources": [...] },
    { "t": "num",     "items": ["bước 1", "bước 2"], "sources": [...] },
    { "t": "table",   "headers": ["Khoá", "Ý nghĩa"], "rows": [["A", "…"]], "sources": [...] },
    { "t": "code",    "lang": "json", "text": "…", "sources": [...] },
    { "t": "figure",  "src": "", "caption": "chú thích hình", "alt": "mô tả cho trình đọc màn hình", "assumption": true },
    { "t": "flow",    "steps": ["nhận request", "if chưa đăng nhập", "DB: orders", "return 201"], "sources": [...] },
    { "t": "refs",    "items": [["Tên tài liệu ngoài", "https://…"]] },
    { "t": "callout", "level": "warn", "text": "điều người đọc dễ làm sai", "sources": [...] }
  ],
  "traces": ["FR-07"]
}

QUY ƯỚC KHỐI
- "flow" là sơ đồ luồng dạng chữ: bước bắt đầu bằng "if " là nhánh điều kiện, "return " là kết thúc,
  "DB: " là truy cập cơ sở dữ liệu. Dùng cho mục cần mô tả kịch bản chạy.
- "figure" chỉ dùng khi thật sự cần một hình. Ở bước này chưa vẽ được hình nên để "src": "" —
  caption và alt vẫn bắt buộc.
- "code" chỉ để trích đoạn ngắn có ý nghĩa, không dán cả tệp.
- Bảng phải có hàng tiêu đề và không có ô trống.

CÁCH LÀM
1. Đọc đúng những tệp cần cho mục đang viết. Đọc thêm khi nguồn khảo sát gắn sai hoặc thiếu.
2. Dùng công cụ Write ghi tệp kết quả của mục đó ra ĐÚNG đường dẫn đã ghi ở trên.
3. Làm lần lượt từng mục theo thứ tự liệt kê. Ghi xong một mục thì ghi tệp NGAY, đừng gom cuối cùng.
4. Chỉ được ghi vào các đường dẫn kết quả nói trên. Không sửa bất kỳ tệp nào trong mã nguồn.

Xong tất cả thì trả lời đúng một dòng: WRITE_DONE`;
}

// ---- the run ---------------------------------------------------------------------------------

const RATE_RE = /rate.?limit|usage limit|quota|429|too many requests|exceeded your|out of (?:credit|tokens)/i;

class WriteRun {
  constructor({ job, std, plan, repoPath, accounts, account, appSettings, engine, only, broadcast }) {
    this.jobId = job.id;
    this.job = job;
    this.std = std;
    this.plan = plan;
    this.repoPath = repoPath;
    this.appSettings = appSettings || {};
    this.account = account;
    this.spares = (accounts || []).filter((a) => a.id !== account.id);
    this.engine = ENGINES.includes(engine) ? engine : "per-doc";
    this.only = only && only.length ? new Set(only) : null;
    this.broadcast = broadcast || (() => {});
    this.eco = economyOf(docgenStore.getSettings());
    this.deferred = 0;            // sections the economy cap pushed to a later run
    this.children = new Set();
    this.pending = new Map();      // absolute out file -> target
    this.marked = new Set();       // section ids already shown as "writing"
    this.tokens = 0;
    this.tokenBase = job.metrics?.tokens || 0;
    this.elapsedBase = job.metrics?.elapsedMs || 0;
    this.stopped = false;
    this.restart = false;
    this.startedAt = Date.now();
    this.done = 0;
    this.failed = [];
  }

  // ---- lifecycle ----
  // Một dòng log + phát ra WS trong cùng một chỗ, để thứ trên màn hình và thứ trong tệp .log
  // không bao giờ lệch nhau.
  say(entry) {
    const row = runlog.log(this.jobId, { stage: "write", run: this.runId, ...entry });
    this.broadcast({ type: "doc:log", jobId: this.jobId, entry: row });
    return row;
  }

  async begin() {
    const cli = ensureClaudeOnPath();
    if (!cli.ok) throw new Error("Không tìm thấy Claude CLI. " + cli.hint);
    const run = runlog.beginRun(this.jobId, { stage: "write", engine: this.engine });
    this.runId = run.runId;
    this.commit = await headCommit(this.repoPath);
    this.say({ kind: "info", text: `⚙ cấu hình lượt viết`,
      detail: [`engine:   ${this.engine}`, `account:  ${this.account.id}`,
        `repo:     ${this.repoPath}`, `commit:   ${this.commit || "(không phải repo git)"}`,
        `model:    ${modelFor(this.eco, this.appSettings.model) || "(mặc định theo account)"}`,
        `tiết kiệm: ${this.eco.on ? this.eco.notes.join(" · ") : "tắt"}`,
        `chỉ định: ${this.only ? [...this.only].join(", ") : "(mọi mục còn thiếu)"}`].join("\n") });
    docgenStore.patchJob(this.jobId, {
      status: "writing", error: null,
      write: { startedAt: this.startedAt, engine: this.engine, account: this.account.id,
        activity: "Bắt đầu viết…", finishedAt: null, warning: null,
        economy: this.eco.on ? this.eco.notes : null, runId: this.runId,
        // Đóng dấu máy + đường dẫn log: log là tệp cục bộ, không đi theo DB. Mở job này trên một
        // máy khác thì đây là thứ duy nhất giải thích được log đang ở đâu.
        logHost: run.host, logFile: run.file },
    });
    this.emitJob();
    this.sweeper = setInterval(() => this.sweep(), SWEEP_MS);
    try {
      // The loop exists for one reason: changing the engine mid-run restarts the pass with
      // whatever is still unwritten, and that can happen more than once.
      for (let pass = 0; pass < 8; pass++) {
        this.restart = false;
        const targets = this.claim();
        if (!targets.length || this.stopped) break;
        await this.runPass(targets);
        this.sweep();
        if (this.stopped || !this.restart) break;
      }
    } finally {
      this.settle();
    }
  }

  stop() {
    this.stopped = true;
    this.say({ kind: "info", text: "⏸ người dùng bấm tạm dừng" });
    this.setActivity("Đang dừng…");
    this.killAll();
  }

  setEngine(engine) {
    if (!ENGINES.includes(engine) || engine === this.engine) return false;
    const from = this.engine;
    this.engine = engine;
    this.restart = true;
    docgenStore.patchJob(this.jobId, { run: { engine } });
    this.say({ kind: "info", text: `⇄ đổi cách chạy ${from} → ${engine}`,
      detail: "Phiên đang chạy bị kill; mục đã có tệp kết quả vẫn được ingest ở lượt sweep kế tiếp." });
    this.setActivity(`Đổi cách chạy sang “${engine}” — dừng gọn phiên đang chạy, giữ nguyên mục đã viết.`);
    this.killAll();
    return true;
  }

  killAll() {
    for (const c of this.children) { try { killChild(c); } catch { /* already gone */ } }
    this.children.clear();
  }

  // Sections this pass is responsible for. A section that is already written, or that the user
  // has edited by hand (Q20), is never claimed — that is the whole protection mechanism.
  claim() {
    this.pending.clear();
    this.marked.clear();
    const out = [];
    const plan = docgenStore.getPlan(this.jobId) || this.plan;
    this.plan = plan;
    for (const doc of plan.docs || []) {
      for (const s of doc.sections || []) {
        if (s.enabled === false || s.status === "skipped") continue;
        if (s.edited) continue;                                   // hand-edited: agent stays out
        const key = `${doc.key}/${s.num}`;
        if (this.only) { if (!this.only.has(s.id)) continue; }
        else if (docgenStore.getIrSection(this.jobId, key) && s.status !== "stale") continue;
        const file = irFileFor(this.jobId, doc.key, s.num);
        // The suffix is what an activity line ("✍️ viết …/ir/sad/6.2.json") is matched against.
        const suffix = `${safeKey(doc.key)}/${String(s.num).replace(/[^0-9.]/g, "_")}.json`;
        const t = { docKey: doc.key, doc, section: s, key, file, suffix };
        out.push(t);
      }
    }
    // Giới hạn của chế độ tiết kiệm áp ở ĐÂY, sau khi đã biết chính xác mục nào còn thiếu: phần bị
    // hoãn giữ nguyên trạng thái pending nên bấm Tiếp tục là chạy đúng chúng, không mất mục nào.
    const { targets, deferred } = capTargets(out, this.eco);
    this.deferred = deferred;
    if (deferred) this.say({ kind: "info", text: `💰 tiết kiệm: lượt này chỉ nhận ${targets.length}/${out.length} mục`,
      detail: `Hoãn ${deferred} mục sang lượt sau (bấm Tiếp tục). Giới hạn: ${this.eco.maxSections} mục/lượt.\n`
        + `Hoãn: ${out.slice(targets.length).map((t) => `${t.docKey} §${t.section.num}`).join(", ")}` });
    // Chỉ xoá tệp cũ của những mục THẬT SỰ chạy lượt này — xoá cả phần bị hoãn thì mất kết quả
    // của mục stale đang chờ viết lại.
    for (const t of targets) {
      try { rmSync(t.file, { force: true }); } catch { /* nothing there yet */ }
      this.pending.set(t.file, t);
    }
    return targets;
  }

  async runPass(targets) {
    if (this.engine === "single") {
      // One session for everything: the terminology stays consistent because the model can see
      // what it already wrote in this conversation.
      await this.session(targets, targets[0].doc, "cả bộ");
      return;
    }
    if (this.engine === "per-section") {
      const queue = [...targets];
      const worker = async () => {
        while (queue.length && !this.stopped && !this.restart) {
          const t = queue.shift();
          await this.session([t], t.doc, `${t.docKey} §${t.section.num}`);
        }
      };
      await Promise.all(Array.from({ length: Math.min(PER_SECTION_POOL, targets.length) }, worker));
      return;
    }
    const byDoc = new Map();
    for (const t of targets) {
      if (!byDoc.has(t.docKey)) byDoc.set(t.docKey, []);
      byDoc.get(t.docKey).push(t);
    }
    await Promise.all([...byDoc.values()].map((g) => this.session(g, g[0].doc, g[0].doc.title)));
  }

  // One Claude session. Retries on a different account when the current one runs out of quota,
  // carrying the transcript across so --resume keeps the context (test case 9).
  async session(targets, doc, label) {
    if (this.stopped || this.restart) return;
    const prompt = buildWritePrompt({
      job: this.job, std: this.std, doc, targets,
      extraSources: (this.job.sources?.extra || []).filter((e) => e.kind === "reference"),
      eco: this.eco,
    });
    let sessionId = randomUUID();
    let account = this.account;
    let resume = false;
    let retries = 0;
    this.say({ session: label, kind: "info", text: `▶ phiên “${label}” · ${targets.length} mục`,
      detail: `mục: ${targets.map((t) => `${t.section.num} ${t.section.title}`).join(" · ")}\n`
        + `prompt: ${prompt.length} ký tự${this.eco.shortPrompt ? " (bản rút gọn)" : ""}` });
    for (;;) {
      try {
        await this.spawn({ prompt, account, sessionId, resume, label });
        return;
      } catch (err) {
        if (this.stopped || this.restart) return;
        // A written file wins over an exit code: nothing left pending means the session did
        // its job and only the process teardown failed.
        this.sweep();
        if (targets.every((t) => !this.pending.has(t.file))) {
          this.say({ session: label, kind: "info",
            text: `↩ ${label}: CLI thoát lỗi nhưng mọi mục đã ghi ra tệp — coi là xong`,
            detail: String(err.message) });
          return;
        }
        const spare = RATE_RE.test(String(err.message)) ? this.spares.shift() : null;
        if (!spare) {
          // The CLI exits non-zero without producing anything often enough to be worth one retry:
          // the observed cause is a session that never got a usable stdin (a known runner.js gap —
          // it spawns with a piped stdin nobody ever closes) and it clears on a second attempt.
          // Losing a whole document to a transient spawn is far more expensive than trying twice.
          if (retries < MAX_TRANSIENT_RETRIES) {
            retries++;
            this.say({ session: label, kind: "run-error",
              text: `⚠ ${label}: phiên thoát bất thường, thử lại lần ${retries}`,
              detail: String(err.message) });
            this.setActivity(`⚠ ${label}: phiên thoát bất thường, thử lại lần ${retries}…`);
            await new Promise((r) => setTimeout(r, 4000));
            if (this.stopped || this.restart) return;
            sessionId = randomUUID();       // nothing was established, so start a clean session
            resume = false;
            continue;
          }
          const msg = explainSpawnError(err);
          // Lý do đầy đủ đi vào log; `section.error` chỉ giữ 300 ký tự cho thẻ UI, nên nếu không
          // ghi ở đây thì phần CLI thật sự nói ra sẽ mất hẳn — đúng lỗ hổng của ca 11.
          this.say({ session: label, kind: "run-error", text: `✖ ${label}: ${msg.slice(0, 160)}`,
            detail: [`giải thích: ${msg}`, "", `lỗi gốc: ${err.message}`,
              `mục chưa ghi được: ${targets.filter((t) => this.pending.has(t.file))
                .map((t) => t.section.num).join(", ")}`].join("\n") });
          for (const t of targets) {
            if (!this.pending.has(t.file)) continue;
            this.pending.delete(t.file);
            this.failed.push({ id: t.section.id, message: msg });
            docgenStore.patchPlanSection(this.jobId, t.section.id,
              { status: "error", error: msg.slice(0, 300) });
            this.emitSection(t, "error", null, msg.slice(0, 300));
          }
          this.setActivity(`✖ ${label}: ${msg.slice(0, 160)}`);
          return;
        }
        copySessionTranscript(account.configDir, spare.configDir, sessionId);
        account = spare;
        resume = true;      // same conversation, different account: --resume keeps the context
        docgenStore.patchJob(this.jobId, {
          write: { ...(docgenStore.getJob(this.jobId)?.write || {}), account: spare.id },
        });
        this.say({ session: label, kind: "run-error",
          text: `⚠ hết quota — đổi sang account “${spare.label || spare.id}”`,
          detail: `lỗi gốc: ${err.message}\nsession ${sessionId} được copy transcript rồi --resume.` });
        this.setActivity(`⚠ Account hết quota — chuyển sang “${spare.label || spare.id}”, `
          + "phiên cũ được nối lại nên ngữ cảnh vẫn giữ.");
      }
    }
  }

  spawn({ prompt, account, sessionId, resume, label }) {
    let child = null;
    return runClaude({
      prompt, cwd: this.repoPath, configDir: account.configDir,
      model: modelFor(this.eco, this.appSettings.model),
      allowCommands: this.appSettings.allowCommands !== false,
      sessionId: resume ? undefined : sessionId,
      resumeSessionId: resume ? sessionId : undefined,
      verbose: true,          // mọi tham số tool, toàn văn Claude nói, stderr và mã thoát vào log
      onSpawn: (c) => { child = c; this.children.add(c); },
      onEvent: (e) => this.onEvent(e, label),
    }).finally(() => { if (child) this.children.delete(child); });
  }

  onEvent(e, label = null) {
    if (e.kind === "result") {
      const u = e.usage || {};
      this.tokens += (u.input_tokens || 0) + (u.output_tokens || 0)
        + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
    }
    // "✍️ viết <path>" is how we learn which section is being worked on right now: it is the
    // only signal that arrives before the file exists.
    const text = e.text || "";
    const hit = /(?:viết|sửa)\s+(\S+\.json)/.exec(text);
    if (hit) {
      const wanted = hit[1].replace(/\\/g, "/").toLowerCase();
      for (const t of this.pending.values()) {
        if (!wanted.endsWith(t.suffix.toLowerCase())) continue;
        if (!this.marked.has(t.section.id)) {
          this.marked.add(t.section.id);
          docgenStore.patchPlanSection(this.jobId, t.section.id, { status: "writing" });
          this.emitSection(t, "writing");
        }
        break;
      }
    }
    // Dòng activity một câu vẫn giữ nguyên cho thanh trạng thái; bản đầy đủ đi vào log.
    if (text && e.kind !== "stderr" && e.kind !== "stdout") this.setActivity(text);
    this.say({ session: label, kind: e.kind, text, detail: e.detail, code: e.code,
      tokens: e.kind === "result" ? this.tokens : undefined });
    this.broadcast({ type: "doc:activity", jobId: this.jobId, text, kind: e.kind });
  }

  // ---- ingesting results ----
  sweep() {
    for (const [file, t] of [...this.pending]) {
      if (!existsSync(file)) continue;
      let raw;
      try { raw = readJsonFile(file); }
      catch { continue; }                 // still being written — try again next tick
      this.pending.delete(file);
      this.ingest(t, raw);
    }
  }

  ingest(t, raw) {
    const ir = normalizeSection(raw, t.section, {
      docKey: t.docKey, commit: this.commit, sources: t.section.sources,
    });
    if (!ir.blocks.length) {
      const msg = "Agent ghi ra tệp nhưng không có khối nội dung nào đọc được.";
      this.failed.push({ id: t.section.id, message: msg });
      // Nội dung tệp agent thật sự ghi ra là thứ duy nhất giải thích được vì sao không parse ra
      // khối nào — không log lại thì phải mở tay tệp trong docgen-work mới biết.
      this.say({ kind: "run-error", text: `✖ §${t.section.num}: ${msg}`,
        detail: `tệp: ${t.file}\n\n--- nội dung agent ghi ---\n`
          + JSON.stringify(raw, null, 1).slice(0, 4000) });
      docgenStore.patchPlanSection(this.jobId, t.section.id, { status: "error", error: msg });
      this.emitSection(t, "error", null, msg);
      return;
    }
    docgenStore.putIrSection(this.jobId, t.key, ir);
    const m = sectionMetrics(ir);
    docgenStore.patchPlanSection(this.jobId, t.section.id, {
      status: "written", error: null, words: m.words, writtenAt: Date.now(),
      stale: false, staleFiles: null, commit: this.commit,
    });
    this.done++;
    this.emitSection(t, "written", m);
    this.emitJob();
  }

  // ---- talking to the UI ----
  emitSection(t, status, metrics = null, error = null) {
    this.broadcast({
      type: "doc:section", jobId: this.jobId, sectionId: t.section.id,
      docKey: t.docKey, num: t.section.num, status, metrics, error,
    });
  }

  setActivity(text) {
    const cur = docgenStore.getJob(this.jobId);
    if (!cur) return;
    docgenStore.patchJob(this.jobId, { write: { ...(cur.write || {}), activity: text } });
  }

  emitJob() {
    const cur = docgenStore.getJob(this.jobId);
    if (!cur) return;
    const { total } = jobMetrics(docgenStore.getIr(this.jobId), docgenStore.getPlan(this.jobId));
    const job = docgenStore.patchJob(this.jobId, {
      metrics: {
        ...cur.metrics, sections: total.sections, done: total.done,
        words: total.words, pages: total.pages, tables: total.tables, figures: total.figures,
        tokens: this.tokenBase + this.tokens,
        elapsedMs: this.elapsedBase + (Date.now() - this.startedAt),
      },
    });
    this.broadcast({ type: "doc:job", jobId: this.jobId, job });
  }

  settle() {
    clearInterval(this.sweeper);
    this.sweep();
    // Whatever is still pending after the pass never produced a file.
    for (const t of this.pending.values()) {
      const msg = this.stopped ? "Người dùng tạm dừng trước khi mục này được viết."
        : "Phiên kết thúc mà không ghi ra tệp kết quả cho mục này.";
      this.failed.push({ id: t.section.id, message: msg });
      docgenStore.patchPlanSection(this.jobId, t.section.id,
        { status: this.stopped ? "pending" : "error", error: this.stopped ? null : msg });
    }
    this.pending.clear();
    const plan = docgenStore.getPlan(this.jobId);
    const { total } = jobMetrics(docgenStore.getIr(this.jobId), plan);
    const errors = (plan?.docs || []).flatMap((d) => d.sections || [])
      .filter((s) => s.status === "error").length;
    const left = total.sections - total.done;
    // Mục bị chế độ tiết kiệm hoãn KHÔNG phải lỗi: chúng còn pending đúng như thiết kế. Đánh dấu
    // `error` ở đây sẽ hiện một hộp đỏ cho một lượt chạy hoàn toàn bình thường.
    const paused = this.stopped;
    const deferredOnly = !paused && !errors && left > 0 && this.deferred >= left;
    const status = paused ? "paused" : errors ? "error" : deferredOnly ? "paused" : left ? "error" : "editing";
    const cur = docgenStore.getJob(this.jobId);
    docgenStore.patchJob(this.jobId, {
      status,
      error: status === "error"
        ? { kind: "write", message: `${errors || left} mục chưa viết được — bấm Tiếp tục để chạy lại đúng những mục đó.`,
            runId: this.runId }
        : null,
      write: {
        ...(cur?.write || {}), finishedAt: Date.now(), engine: this.engine, runId: this.runId,
        deferred: this.deferred || 0,
        activity: paused ? "Đã tạm dừng."
          : deferredOnly ? `Xong lượt tiết kiệm — còn ${left} mục, bấm Tiếp tục.`
          : errors || left ? "Kết thúc với mục chưa xong." : "Đã viết xong.",
      },
      metrics: {
        ...cur?.metrics, sections: total.sections, done: total.done,
        words: total.words, pages: total.pages, tables: total.tables, figures: total.figures,
        tokens: this.tokenBase + this.tokens,
        elapsedMs: this.elapsedBase + (Date.now() - this.startedAt),
      },
    });
    runlog.endRun(this.jobId, { stage: "write", ok: status !== "error",
      text: `■ hết lượt · ${this.done} mục viết được · ${total.done}/${total.sections} tổng cộng`,
      detail: [`kết thúc ở trạng thái: ${status}`,
        `mục lỗi: ${errors} · mục còn thiếu: ${left} · bị hoãn do tiết kiệm: ${this.deferred}`,
        `token lượt này: ${this.tokens} · tổng: ${this.tokenBase + this.tokens}`,
        `thời gian: ${Math.round((Date.now() - this.startedAt) / 1000)}s`].join("\n") });
    docgenStore.flush();
    this.broadcast({ type: "doc:job", jobId: this.jobId, job: docgenStore.getJob(this.jobId) });
  }
}

export function createWriteRun(opts) {
  const run = new WriteRun(opts);
  run.promise = run.begin();
  return run;
}

// How many sections a write pass would actually touch, and what they cost — the forecast behind
// the "▶ Bắt đầu viết" button. Mirrors WriteRun.claim() exactly, minus the side effects.
export function pendingSections(jobId, plan, { only = null, includeStale = true } = {}) {
  const set = only && only.length ? new Set(only) : null;
  const out = [];
  for (const doc of plan?.docs || []) {
    for (const s of doc.sections || []) {
      if (s.enabled === false || s.status === "skipped") continue;
      if (s.edited) continue;
      if (set) { if (!set.has(s.id)) continue; }
      else {
        const has = !!docgenStore.getIrSection(jobId, `${doc.key}/${s.num}`);
        if (has && !(includeStale && s.status === "stale")) continue;
      }
      out.push({ docKey: doc.key, doc, section: s });
    }
  }
  return out;
}

export { pagesOf };
