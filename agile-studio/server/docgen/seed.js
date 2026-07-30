// Representative data for the docgen board, so every screen can be inspected without running a
// real survey (which costs tokens and a few minutes).
//
// Preferred way — through the running app, no file contention:
//   curl -X POST http://localhost:4311/api/projects/1/doc-seed
//   curl -X POST "http://localhost:4311/api/projects/1/doc-seed?clear=1"
//
// Offline way — only with Agile Studio STOPPED, otherwise the running server holds an older copy
// of docgen.json in memory and will write over what was just seeded:
//   node server/docgen/seed.js [projectId] [--clear] [--force]
//
// Seeded rows carry `seeded: true` so clearing never touches anything a real run produced.
// All content is invented: a fictional order service, fictional paths, fictional people.
import { docgenStore } from "../store/docgen.js";
import { getStandard } from "./standards/index.js";
import { buildPlan, planStats } from "./plan.js";

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

function baseJob(project, over) {
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

export function clearSeed() {
  let jobs = 0, presets = 0;
  for (const j of docgenStore.listJobs()) if (j.seeded) { docgenStore.deleteJob(j.id); jobs++; }
  for (const p of docgenStore.listPresets()) if (p.seeded) { docgenStore.deletePreset(p.id); presets++; }
  docgenStore.flush();
  return { jobs, presets };
}

export function seedDocgen(project) {
  const made = [];

  // 1) waiting at the approval gate — the screen D1 is really about
  {
    const std = getStandard("arc42");
    const job = docgenStore.createJob(baseJob(project, {
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
    made.push({ id: job.id, status: "plan-review", standard: "arc42", note: `${st.sections}/${st.total} mục bật` });
  }

  // 2) approved and frozen, six files — the card with a file list and the read-only outline
  {
    const std = getStandard("iso15289");
    const job = docgenStore.createJob(baseJob(project, {
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
    made.push({ id: job.id, status: "plan-approved", standard: "iso15289",
      note: `${st.sections}/${st.total} mục bật · 6 tệp` });
  }

  // 3) never surveyed — the entry point for "áp preset, không tốn token"
  {
    const job = docgenStore.createJob(baseJob(project, {
      name: "User Documentation", standardId: "iso26514", status: "draft",
      style: { templateId: null, templatePath: "", tone: "detailed", language: "vi-keep-en", depth: "standard" },
    }));
    made.push({ id: job.id, status: "draft", standard: "iso26514", note: "chưa khảo sát" });
  }

  // 4) interrupted — the card that offers "Tiếp tục"
  {
    const job = docgenStore.createJob(baseJob(project, {
      name: "Software Requirements Specification", standardId: "iso29148", status: "error",
      error: { kind: "interrupted", message: "Server khởi động lại khi đang khảo sát — bấm Tiếp tục để chạy lại." },
      survey: { startedAt: days(0.02), account: "default", activity: "📖 đọc src/api/orders/create.ts" },
    }));
    made.push({ id: job.id, status: "error", standard: "iso29148", note: "ngắt giữa chừng, có nút Tiếp tục" });
  }

  // 5) two presets, so "Áp preset…" is not an empty dropdown
  const std = getStandard("arc42");
  const full = buildPlan({ std, projectName: project.name, survey: null });
  const asPreset = (name, isOn) => docgenStore.savePreset({
    seeded: true, name, standardId: "arc42",
    docs: full.docs.map((d) => ({ key: d.key, sections: d.sections.map((s) => ({
      num: s.num, title: s.title, kind: s.kind, hint: s.hint, required: s.required,
      accept: s.accept, enabled: isOn(s), origin: s.origin })) })),
  });
  const presets = [
    asPreset("Kiến trúc — bản đầy đủ", () => true).name,
    asPreset("Kiến trúc — bản rút gọn cho bàn giao", (s) => !["9", "11", "12"].includes(s.num)).name,
  ];

  docgenStore.flush();
  return { project: { id: project.id, name: project.name }, jobs: made, presets };
}

// ---- CLI ------------------------------------------------------------------------------------
// import.meta.main is not available on every Node this app supports, so detect by argv instead.
const isCli = process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("docgen/seed.js");
if (isCli) {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const { store } = await import("../store.js");

  // Refuse to fight the running app over the same JSON file — that silently loses whichever
  // side writes first.
  if (!force) {
    const alive = await fetch("http://localhost:4311/api/platform").then(() => true).catch(() => false);
    if (alive) {
      console.error("Agile Studio đang chạy ở cổng 4311. Server đó giữ docgen.json trong bộ nhớ nên nó sẽ");
      console.error("ghi đè phần vừa seed. Chọn một trong hai:");
      console.error("  · Seed qua app đang chạy:  curl -X POST http://localhost:4311/api/projects/<id>/doc-seed");
      console.error("  · Hoặc tắt app rồi chạy lại lệnh này (thêm --force nếu chắc chắn muốn bỏ qua cảnh báo).");
      process.exit(1);
    }
  }

  if (args.includes("--clear")) {
    const r = clearSeed();
    console.log(`Đã xoá ${r.jobs} bộ tài liệu mẫu và ${r.presets} preset mẫu.`);
    process.exit(0);
  }

  const list = store.listProjects();
  if (!list.length) { console.error("Chưa có project nào trong Studio. Thêm một project rồi chạy lại."); process.exit(1); }
  const arg = args.find((a) => !a.startsWith("--"));
  const project = arg ? list.find((x) => String(x.id) === String(arg)) : list[0];
  if (!project) {
    console.error(`Không thấy project #${arg}. Có: ` + list.map((x) => `${x.id}=${x.name}`).join(", "));
    process.exit(1);
  }

  const out = seedDocgen(project);
  console.log(`Đã seed vào project #${out.project.id} “${out.project.name}”:`);
  for (const j of out.jobs) console.log(`  ${j.id}  ${j.status.padEnd(14)} ${j.standard.padEnd(10)} ${j.note}`);
  console.log("  preset: " + out.presets.join(" · "));
  console.log("\nMở tab 📚 Tài liệu của project này để xem. Xoá: node server/docgen/seed.js --clear");
}
