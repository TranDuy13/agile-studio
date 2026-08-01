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
import { sectionMetrics, jobMetrics } from "./ir.js";

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

// --- IR for the progress screen (D2) ----------------------------------------------------------
// Written content for the same fictional order service, so the two progress views, the block
// viewer, the editor and an export can all be looked at without running a single session.
const OLD_COMMIT = "a1b2c3d";      // what the sections were "written against"
const src = (file, from, to) => ({ file, ...(from ? { lines: [from, to || from + 20] } : {}), commit: OLD_COMMIT });

function irFor(num, title, kind) {
  const base = { doc: "sad", section: num, title, kind, traces: [], sources: [src("src/api/orders/create.ts")] };
  if (num === "2") {
    return { ...base, sources: [src("package.json"), src("config/default.yml")], blocks: [
      { t: "p", text: "Thiết kế phải chạy được trên Node 22 vì tầng hàng đợi dùng API stream của "
        + "phiên bản này, và phải giữ tương thích với PostgreSQL 14 trở lên.",
        sources: [src("package.json", 8, 22)] },
      { t: "table", headers: ["Ràng buộc", "Giá trị", "Nơi khai báo"],
        rows: [["Runtime", "Node 22 LTS", "package.json → engines"],
          ["Cơ sở dữ liệu", "PostgreSQL ≥ 14", "config/default.yml"],
          ["Hàng đợi", "Redis 7 (BullMQ)", "config/queue.yml"]],
        widths: [1.5, 1.6, 2.2], sources: [src("config/default.yml", 1, 40)] },
    ] };
  }
  if (num === "6.2") {
    return { ...base, blocks: [
      { t: "p", text: "Endpoint POST /api/orders nhận CreateOrderInput, kiểm tra quyền qua checkPolicy, "
        + "sinh mã đơn theo cấu hình orders.codePattern rồi ghi hai bảng orders và order_items.",
        sources: [src("src/api/orders/create.ts", 41, 78)] },
      { t: "flow", steps: ["nhận request POST /api/orders", "if người gọi chưa đăng nhập",
        "DB: orders + order_items", "return 201 kèm mã đơn"],
        caption: "Luồng tạo đơn hàng", alt: "Bốn bước từ nhận request tới khi trả về mã đơn",
        sources: [src("src/api/orders/create.ts", 41, 120)] },
      { t: "code", lang: "json", text: '{\n  "orderId": "ORD-000241",\n  "status": "created"\n}',
        sources: [src("src/api/orders/dto.ts", 12, 24)] },
      { t: "callout", level: "warn", text: "Nếu tiến trình nền dừng, khách vẫn gửi đơn thành công nhưng "
        + "đơn không xuất hiện trong danh sách. Dấu hiệu nhận biết là số thông điệp tồn trong hàng đợi tăng dần.",
        assumption: true },
    ] };
  }
  if (kind === "reference") {
    return { ...base, blocks: [
      { t: "p", text: `Mục ${num} liệt kê các thành phần liên quan và giá trị cấu hình tương ứng.`,
        sources: [src("src/modules/orders/index.ts", 1, 60)] },
      { t: "table", headers: ["Thành phần", "Trách nhiệm"],
        rows: [["src/api", "Nhận request, xác thực khuôn dạng"],
          ["src/modules/orders", "Quy tắc nghiệp vụ của đơn hàng"],
          ["src/shared/queue", "Đẩy và tiêu thụ thông điệp"]],
        widths: [1.7, 3.4], sources: [src("src/modules/")] },
    ] };
  }
  return { ...base, blocks: [
    { t: "p", text: `Mục ${num} giải thích vì sao hệ thống được tổ chức như hiện tại và điều gì `
      + "sẽ hỏng nếu làm khác đi.", sources: [src("README.md", 1, 40)] },
    { t: "bullets", items: ["Tách nhận đơn khỏi xử lý đơn để lúc cao điểm việc nhận đơn không bị chậm theo.",
      "Đánh đổi: đơn có thể được ghi trễ vài giây so với lúc khách bấm gửi."],
      sources: [src("docs/vision.md")] },
  ] };
}

// Which sections of the seeded arc42 set are in which state — this is the shape MH 4 was drawn
// against: most done, one being written, one hand-edited, one stale, one stuck.
const IR_PLAN = [
  ["1", "written"], ["2", "written"], ["3", "written"], ["4", "written"], ["5", "written"],
  ["5.1", "written"], ["5.2", "written"], ["5.3", "written"],
  ["6", "written"], ["6.1", "written"], ["6.2", "edited"], ["6.3", "writing"],
  ["7", "written"], ["8", "stale"], ["8.1", "pending"], ["9", "pending"],
  ["10", "error"], ["12", "pending"],
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

  // 5) mid-write — the screen D2 is really about (MH 4). Content, one section in flight, one
  //    hand-edited, one stale, one stuck, and an export already on disk.
  {
    const std = getStandard("arc42");
    const job = docgenStore.createJob(baseJob(project, {
      name: "Software Architecture Document — đang viết", standardId: "arc42", status: "writing",
      facts: { stack: SURVEY.stack, items: SURVEY.facts },
      survey: { startedAt: days(2), finishedAt: days(2), elapsedMs: 252000, tokens: 186400,
        account: "default", activity: "" },
      write: { startedAt: days(0.03), engine: "per-doc", account: "default",
        activity: "📖 đọc src/jobs/notify.ts" },
    }));
    const plan = buildPlan({ std, projectName: project.name, survey: SURVEY });
    docgenStore.putPlan(job.id, plan);
    const st = planStats(plan, "detailed");
    docgenStore.approvePlan(job.id, { engine: "per-doc", estTokens: st.estTokens });

    const wanted = new Map(IR_PLAN);
    let done = 0;
    for (const doc of docgenStore.getPlan(job.id).docs) {
      for (const s of doc.sections) {
        const state = wanted.get(String(s.num));
        if (!state || s.status === "skipped") continue;
        if (state === "pending" || state === "writing") {
          docgenStore.patchPlanSection(job.id, s.id, { status: state });
          continue;
        }
        if (state === "error") {
          docgenStore.patchPlanSection(job.id, s.id, { status: "error",
            error: "Agent ghi ra tệp nhưng không có khối nội dung nào đọc được." });
          continue;
        }
        const ir = irFor(String(s.num), s.title, s.kind);
        docgenStore.putIrSection(job.id, `${doc.key}/${s.num}`, ir);
        const m = sectionMetrics(ir);
        docgenStore.patchPlanSection(job.id, s.id, {
          status: state, words: m.words, commit: OLD_COMMIT, writtenAt: days(0.05),
          ...(state === "edited" ? { edited: true, editedAt: days(0.04) } : {}),
          // A stale section is one whose sources moved on: the files are recorded so the tooltip
          // can say which ones, exactly as a real `git diff` pass would.
          ...(state === "stale" ? { staleFiles: ["src/shared/auth/policy.ts", "src/shared/i18n/index.ts"] } : {}),
        });
        done++;
      }
    }
    const roll = jobMetrics(docgenStore.getIr(job.id), docgenStore.getPlan(job.id));
    docgenStore.patchJob(job.id, { run: { engine: "per-doc" },
      metrics: { ...roll.total, tokens: 964300, elapsedMs: 2466000 } });
    docgenStore.addExport(job.id, {
      format: "docx", destDir: "D:\\tai-lieu\\dich-vu-don-hang", draft: true,
      python: { bin: "python", version: "3.12.13", docx: "1.2.0" },
      files: [{ path: "D:\\tai-lieu\\dich-vu-don-hang\\" + project.name + " — Software Architecture v1.0.docx",
        bytes: 1_842_000, title: "Software Architecture Document",
        counts: { sections: done, empty: 4, tables: 6, figures: 3 } }],
      skipped: [], warnings: [], counts: { sections: done, tables: 6, figures: 3 },
    });
    made.push({ id: job.id, status: "writing", standard: "arc42",
      note: `${roll.total.done}/${roll.total.sections} mục có nội dung · 1 sửa tay · 1 đã cũ · 1 lỗi` });
  }

  // 6) two presets, so "Áp preset…" is not an empty dropdown
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
