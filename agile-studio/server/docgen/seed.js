// Seed the docgen board with representative data, so every screen can be inspected without
// running a real survey (which costs tokens and a few minutes).
//
//   node server/docgen/seed.js            → seeds into the first project in the store
//   node server/docgen/seed.js 3          → seeds into project #3
//   node server/docgen/seed.js --clear    → removes seeded jobs and presets, leaves real ones
//
// Seeded rows carry `seeded: true` so --clear never touches anything a real run produced.
// All content is invented: a fictional order service, fictional file paths, fictional people.
import { store } from "../store.js";
import { docgenStore } from "../store/docgen.js";
import { getStandard } from "./standards/index.js";
import { buildPlan } from "./plan.js";
import { planStats } from "./plan.js";

const args = process.argv.slice(2);
const clear = args.includes("--clear");
const projectArg = args.find((a) => !a.startsWith("--"));

function pickProject() {
  const list = store.listProjects();
  if (!list.length) {
    console.error("Chưa có project nào trong Studio. Thêm một project rồi chạy lại.");
    process.exit(1);
  }
  if (projectArg) {
    const p = list.find((x) => String(x.id) === String(projectArg));
    if (!p) { console.error(`Không thấy project #${projectArg}. Có: ` + list.map((x) => `${x.id}=${x.name}`).join(", ")); process.exit(1); }
    return p;
  }
  return list[0];
}

if (clear) {
  let n = 0;
  for (const j of docgenStore.listJobs()) if (j.seeded) { docgenStore.deleteJob(j.id); n++; }
  let p = 0;
  for (const preset of docgenStore.listPresets()) if (preset.seeded) { docgenStore.deletePreset(preset.id); p++; }
  docgenStore.flush();
  console.log(`Đã xoá ${n} bộ tài liệu mẫu và ${p} preset mẫu.`);
  process.exit(0);
}

const project = pickProject();
const days = (n) => Date.now() - n * 864e5;

// --- what the surveying agent would have answered for an order service -----------------------
const SURVEY = {
  stack: { runtime: "Node 22", languages: ["TypeScript", "SQL"],
    frameworks: ["Express", "BullMQ"], datastores: ["PostgreSQL", "Redis"] },
  facts: [
    { level: "ok", text: "9 module · 4 tầng · 41 tệp nguồn ngoài kiểm thử" },
    { level: "ok", text: "PostgreSQL 18 bảng · Redis dùng cho hàng đợi đơn hàng" },
    { level: "ok", text: "11 route handler → 11 luồng nghiệp vụ tách bạch" },
    { level: "ok", text: "6 tích hợp ngoài: cổng thanh toán, SMS, e-mail, kho, CRM, giám sát" },
    { level: "warn", text: "Không có bộ kiểm thử tự động cho tầng nghiệp vụ" },
    { level: "warn", text: "3 TODO còn lại trong mã, đều ở phần xử lý hoàn tiền" },
  ],
  docs: [{
    key: "sad",
    sections: [
      { num: "1", keep: true, sources: ["README.md", "docs/vision.md"] },
      { num: "2", keep: true, sources: ["package.json", "config/default.yml"] },
      { num: "3", keep: true, sources: ["src/integrations/", "src/api/"] },
      { num: "4", keep: true, sources: ["src/", "docs/adr/"] },
      { num: "5", keep: true, sources: ["src/modules/", "src/shared/"], subsections: [
        { num: "5.1", title: "API layer", sources: ["src/api/"] },
        { num: "5.2", title: "Domain modules", sources: ["src/modules/orders/", "src/modules/billing/"] },
        { num: "5.3", title: "Shared infrastructure", sources: ["src/shared/db/", "src/shared/queue/"] },
      ] },
      { num: "6", keep: true, sources: ["src/api/", "src/jobs/"], subsections: [
        { num: "6.1", title: "Xác thực & phân quyền", sources: ["src/api/auth/"] },
        { num: "6.2", title: "Tạo đơn hàng", sources: ["src/api/orders/create.ts"] },
        { num: "6.3", title: "Job nền & hàng đợi", sources: ["src/jobs/", "src/shared/queue/"] },
      ] },
      { num: "7", keep: true, sources: ["Dockerfile", "docker-compose.yml", ".github/workflows/ci.yml"] },
      { num: "8", keep: true, sources: ["src/shared/auth/", "src/shared/logger/", "src/shared/i18n/"] },
      { num: "9", keep: true, sources: ["docs/adr/", "git log"] },
      { num: "10", keep: true, sources: ["config/sla.yml"] },
      { num: "11", keep: false, reason: "Chỉ tìm được 3 TODO, chưa đủ để thành một mục riêng — đề xuất gộp vào §9." },
      { num: "12", keep: true, sources: ["src/"] },
    ],
  }],
  added: [{ docKey: "sad", afterNum: "8", title: "Cross-cutting Concepts — i18n",
    kind: "explanation", hint: "Đa ngôn ngữ áp cho toàn hệ thống", sources: ["src/shared/i18n/"] }],
};

const HISTORY = [
  { date: new Date(days(9)).toISOString().slice(0, 10), version: "1.0", change: "Khởi tạo", by: "Nguyễn An" },
];

function baseJob(over) {
  return {
    projectId: project.id, projectName: project.name, seeded: true,
    sources: { main: { projectId: project.id, path: project.repo_path }, extra: [] },
    scope: { mode: "all", features: [], byAuthor: false, authors: [], from: "", to: "" },
    meta: { docIdPrefix: "AP", classification: "Nội bộ", docStatus: "Bản nháp", approvals: false,
      control: [], history: HISTORY },
    style: { templateId: null, templatePath: "", tone: "concise", language: "vi-keep-en", depth: "detailed" },
    run: { engine: "per-doc" },
    metrics: { sections: 0, done: 0, tokens: 0, elapsedMs: 0 },
    sessionIds: [],
    ...over,
  };
}

const made = [];

// 1) waiting at the approval gate — the screen D1 is really about
{
  const std = getStandard("arc42");
  const job = docgenStore.createJob(baseJob({
    name: "Software Architecture Document", standardId: "arc42", status: "plan-review",
    facts: { stack: SURVEY.stack, items: SURVEY.facts },
    survey: { startedAt: days(1), finishedAt: days(1), elapsedMs: 252000, tokens: 186400,
      account: "default", activity: "" },
    metrics: { sections: 0, done: 0, tokens: 186400, elapsedMs: 252000 },
  }));
  const plan = buildPlan({ std, projectName: project.name, survey: SURVEY });
  docgenStore.putPlan(job.id, plan);
  const st = planStats(plan, "detailed");
  docgenStore.patchJob(job.id, { metrics: { ...job.metrics, sections: st.sections, tokens: 186400 } });
  made.push(`${job.id}  plan-review   arc42       ${st.sections} mục bật / ${st.total}`);
}

// 2) approved and frozen, six files — shows the card with a file list and the read-only outline
{
  const std = getStandard("iso15289");
  const job = docgenStore.createJob(baseJob({
    name: "Life-cycle Information Items", standardId: "iso15289", status: "plan-approved",
    facts: { stack: SURVEY.stack, items: SURVEY.facts.slice(0, 4) },
    survey: { startedAt: days(3), finishedAt: days(3), elapsedMs: 418000, tokens: 372900, account: "default", activity: "" },
    style: { templateId: null, templatePath: "", tone: "academic", language: "vi-keep-en", depth: "standard" },
  }));
  const plan = buildPlan({ std, projectName: project.name, survey: null });
  // a few sections switched off by hand before approval, so the frozen denominator is visible
  for (const [docKey, num] of [["config-mgmt", "6"], ["operations", "7"], ["repo-structure", "5"]]) {
    const s = plan.docs.find((d) => d.key === docKey)?.sections.find((x) => x.num === num);
    if (s) { s.enabled = false; s.userEnabled = false; }
  }
  docgenStore.putPlan(job.id, plan);
  const st = planStats(plan, "standard");
  docgenStore.approvePlan(job.id, { engine: "single", estTokens: st.estTokens });
  docgenStore.patchJob(job.id, { run: { engine: "single" },
    metrics: { sections: st.sections, done: 0, tokens: 372900, elapsedMs: 418000 } });
  made.push(`${job.id}  plan-approved iso15289    ${st.sections} mục bật / ${st.total} · 6 tệp`);
}

// 3) never surveyed — the entry point for "áp preset, không tốn token"
{
  const job = docgenStore.createJob(baseJob({
    name: "User Documentation", standardId: "iso26514", status: "draft",
    style: { templateId: null, templatePath: "", tone: "detailed", language: "vi-keep-en", depth: "standard" },
  }));
  made.push(`${job.id}  draft         iso26514    chưa khảo sát`);
}

// 4) interrupted — the card that offers "Tiếp tục"
{
  const job = docgenStore.createJob(baseJob({
    name: "Software Requirements Specification", standardId: "iso29148", status: "error",
    error: { kind: "interrupted", message: "Server khởi động lại khi đang khảo sát — bấm Tiếp tục để chạy lại." },
    survey: { startedAt: days(0.02), account: "default", activity: "📖 đọc src/api/orders/create.ts" },
  }));
  made.push(`${job.id}  error         iso29148    ngắt giữa chừng, có nút Tiếp tục`);
}

// 5) two presets, so "Áp preset…" is not an empty dropdown
{
  const std = getStandard("arc42");
  const full = buildPlan({ std, projectName: project.name, survey: null });
  docgenStore.savePreset({ seeded: true, name: "Kiến trúc — bản đầy đủ", standardId: "arc42",
    docs: full.docs.map((d) => ({ key: d.key, sections: d.sections.map((s) => ({
      num: s.num, title: s.title, kind: s.kind, hint: s.hint, required: s.required,
      accept: s.accept, enabled: true, origin: s.origin })) })) });
  docgenStore.savePreset({ seeded: true, name: "Kiến trúc — bản rút gọn cho bàn giao", standardId: "arc42",
    docs: full.docs.map((d) => ({ key: d.key, sections: d.sections.map((s) => ({
      num: s.num, title: s.title, kind: s.kind, hint: s.hint, required: s.required, accept: s.accept,
      enabled: !["9", "11", "12"].includes(s.num), origin: s.origin })) })) });
  made.push("2 preset: “Kiến trúc — bản đầy đủ” và “Kiến trúc — bản rút gọn cho bàn giao”");
}

docgenStore.flush();
console.log(`Đã seed vào project #${project.id} “${project.name}”:`);
for (const line of made) console.log("  " + line);
console.log("\nMở tab 📚 Tài liệu của project này để xem. Xoá dữ liệu mẫu: node server/docgen/seed.js --clear");
