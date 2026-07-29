// The surveying stage: one Claude session reads the real repository and proposes an outline.
//
// It runs through runner.js like every other session in the app, so pausing, switching accounts
// and token accounting all behave the same way. The agent writes its answer to a file instead of
// printing it, because the session stream only carries the first 400 characters of a text block.
import { readFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runClaude } from "../runner.js";
import { WORK_DIR } from "../store/docgen.js";
import { SOURCE_LABELS } from "./standards/index.js";

export function workDirFor(jobId) {
  const dir = join(WORK_DIR, String(jobId));
  mkdirSync(dir, { recursive: true });
  return dir;
}

const SCOPE_TEXT = (job) => {
  const s = job.scope || {};
  const parts = [];
  parts.push(s.mode === "feature"
    ? `Chỉ các feature sau: ${(s.features || []).join(", ") || "(chưa liệt kê — tự suy từ tài liệu agile)"}`
    : "Toàn bộ sản phẩm.");
  if (s.byAuthor) {
    parts.push(`CHỈ tính phần đóng góp của các identity git sau: ${(s.authors || []).join(", ") || "(chưa chọn)"}.`
      + " Thư mục có dưới 3 commit của những identity này thì xếp xuống phụ lục, không đưa vào mục chính.");
  }
  if (s.from || s.to) parts.push(`Khoảng thời gian: ${s.from || "đầu repo"} → ${s.to || "nay"}.`);
  return parts.join(" ");
};

function sectionLines(std) {
  const out = [];
  for (const d of std.docs) {
    out.push(`  Tài liệu "${d.key}" — ${d.title}:`);
    for (const s of d.sections)
      out.push(`    - ${s.num} | ${s.title} | kind=${s.kind} | ${s.required ? "bắt buộc" : "tuỳ chọn"}`
        + ` | ý nghĩa: ${s.hint} | nguồn gợi ý: ${s.from.map((f) => SOURCE_LABELS[f]).join(", ")}`);
  }
  return out.join("\n");
}

// Contract with the agent. Kept explicit and short — a long prompt costs tokens on every survey.
export function buildSurveyPrompt({ job, std, outFile, extraSources = [], revise = null, plan = null }) {
  const head = `Bạn đang KHẢO SÁT một mã nguồn thật để ĐỀ XUẤT DÀN Ý cho bộ tài liệu sản phẩm theo chuẩn `
    + `${std.standard || std.label}. KHÔNG viết nội dung tài liệu ở bước này.`;

  const sources = [`- Nguồn chính (thư mục hiện tại): ${job.sources?.main?.path || "."}`]
    .concat(extraSources.map((e) => `- ${e.kind === "reference" ? "Tài liệu tham chiếu" : "Mã nguồn cùng sản phẩm"}: ${e.path}`))
    .join("\n");

  const reviseBlock = revise
    ? `\nDÀN Ý HIỆN TẠI (JSON) — hãy sửa theo yêu cầu của người dùng, giữ nguyên phần không liên quan:\n`
      + "```json\n" + JSON.stringify(compactPlan(plan), null, 1) + "\n```\n"
      + `YÊU CẦU CỦA NGƯỜI DÙNG: ${revise}\n`
    : "";

  return `${head}

PHẠM VI: ${SCOPE_TEXT(job)}

NGUỒN ĐƯỢC PHÉP ĐỌC:
${sources}

BỘ TÀI LIỆU CỦA CHUẨN (không đổi tên mục, không dịch tên mục):
${sectionLines(std)}
${reviseBlock}
VIỆC CẦN LÀM
1. Đọc mã nguồn ở mức đủ để biết hệ thống làm gì: cấu trúc thư mục, phụ thuộc, cấu hình,
   route/endpoint, lược đồ dữ liệu, hạ tầng chạy, kiểm thử.
2. Với TỪNG mục của chuẩn, quyết định: giữ hay bỏ (mục không có dữ liệu thật thì đề xuất bỏ),
   liệt kê tệp/thư mục thật sẽ dùng làm nguồn, và nếu mục quá lớn thì tách thành mục con.
3. Đề xuất thêm mục con hoặc mục mới khi mã nguồn có phần quan trọng mà chuẩn chưa phủ.
4. KHÔNG bịa. Mọi nguồn phải là đường dẫn có thật trong repo (tương đối so với thư mục gốc).

TRẢ KẾT QUẢ
Dùng công cụ Write ghi ĐÚNG một tệp JSON (không có văn bản nào khác) vào:
${outFile}

Lược đồ JSON:
{
  "stack": { "runtime": "", "languages": [], "frameworks": [], "datastores": [] },
  "facts": [ { "level": "ok" | "warn", "text": "một câu, có số liệu thật" } ],
  "docs": [
    { "key": "<khoá tài liệu>",
      "sections": [
        { "num": "5", "keep": true, "reason": "vì sao giữ/bỏ, một câu",
          "sources": ["đường/dẫn/thật.ts"],
          "subsections": [ { "num": "6.1", "title": "Tên mục con", "sources": ["..."] } ] }
      ] }
  ],
  "added": [ { "docKey": "sad", "afterNum": "8", "title": "Tên mục mới (tiếng Anh nếu là tên chuẩn)",
               "kind": "reference|howto|explanation|tutorial", "hint": "giải thích một dòng tiếng Việt",
               "sources": ["..."] } ]
}

Ghi xong tệp thì trả lời đúng một dòng: SURVEY_DONE`;
}

// The plan shape sent back to the agent when asking for a revision: titles and numbers only,
// so the revision prompt stays small.
function compactPlan(plan) {
  return {
    docs: (plan?.docs || []).map((d) => ({
      key: d.key,
      sections: (d.sections || []).map((s) => ({ num: s.num, title: s.title, enabled: s.enabled !== false })),
    })),
  };
}

// Accepts a bare JSON file, or one wrapped in a markdown fence by a chatty model.
export function parseSurveyFile(file) {
  if (!existsSync(file)) throw new Error("Agent không ghi ra tệp kết quả khảo sát.");
  let raw = readFileSync(file, "utf8").trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) raw = fence[1].trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start > 0 || end < raw.length - 1) raw = raw.slice(start, end + 1);
  const data = JSON.parse(raw);
  if (!data || typeof data !== "object") throw new Error("Kết quả khảo sát không phải JSON hợp lệ.");
  return data;
}

// Runs the survey session. Rejects on spawn/exit failure so the caller can park the job in `error`.
export async function runSurvey({ job, std, repoPath, configDir, model, allowCommands, revise, plan, onEvent, onSpawn }) {
  const dir = workDirFor(job.id);
  const outFile = join(dir, revise ? "revise.json" : "survey.json");
  try { rmSync(outFile, { force: true }); } catch { /* first run */ }

  const prompt = buildSurveyPrompt({
    job, std, outFile: outFile.replace(/\\/g, "/"),
    extraSources: job.sources?.extra || [], revise, plan,
  });

  let result = null, exitError = null;
  try {
    ({ result } = await runClaude({
      prompt, cwd: repoPath, configDir, model, allowCommands,
      onEvent: (e) => onEvent?.(e), onSpawn,
    }));
  } catch (e) {
    // The CLI sometimes exits non-zero after it has already written the answer (a known one:
    // "no stdin data received in 3s"). The file is the contract, so a readable file wins over
    // the exit code; if there is no file, the original error is what the user needs to see.
    exitError = e;
  }
  if (exitError && !existsSync(outFile)) throw exitError;
  return { survey: parseSurveyFile(outFile), result, outFile, exitError: exitError?.message || null };
}
