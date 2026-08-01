// Hồi quy D1 — luồng "tạo bộ tài liệu → dàn ý → duyệt → mở khoá" sau khi D2, D2.1 và D3 chồng lên.
//
// Vì sao cần: D1-BANGIAO §5 kiểm 12 ca bằng tay, trong đó có 3 lượt khảo sát thật (~600K token).
// Từ đó tới nay D2 sửa `routes/docgen.js` (+298 dòng), D2.1 chèn cổng tiết kiệm vào giữa luồng, D3
// đổi cả tầng điều hướng — mà D2-BANGIAO §4 Nhóm A #5 vẫn ghi "CHƯA chạy lại". Bài này biến phần
// hồi quy đó thành thứ chạy lại được bất cứ lúc nào và **không tiêu một token nào**: dàn ý lấy từ
// preset thay cho khảo sát, đúng như §4 gợi ý.
//
// KHÔNG kiểm: khảo sát thật, sửa dàn ý bằng agent (ca 7), xem trước theo tác giả git (ca 2) —
// những thứ đó cần gọi model hoặc cần một repo git có lịch sử thật.
//
// Cổng 4398 (d21-http.mjs dùng 4399) nên chạy song song hai bài cũng không tranh chấp. Vẫn đọc/ghi
// `~/.agile-studio` thật, nên tắt server dev trước cho chắc (D2-BANGIAO §6 #6).
import express from "express";
import { registerDocRoutes } from "../server/routes/docgen.js";
import { store } from "../server/store.js";
import { docgenStore } from "../server/store/docgen.js";
import { DEMO_NAME } from "../server/docgen/demo.js";

const PORT = 4398;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${x}`)); };

const app = express();
app.use(express.json({ limit: "30mb" }));
registerDocRoutes(app, () => {});
const srv = app.listen(PORT);
await new Promise((r) => srv.on("listening", r));
await new Promise((r) => setTimeout(r, 900));   // đợi bootstrap project mẫu

const U = `http://localhost:${PORT}`;
const call = (m, p, b) => fetch(U + p, {
  method: m, headers: { "Content-Type": "application/json" },
  body: b === undefined ? undefined : JSON.stringify(b),
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
const get = (p) => call("GET", p);
const post = (p, b) => call("POST", p, b || {});
const put = (p, b) => call("PUT", p, b);
const del = (p) => call("DELETE", p);

const project = store.listProjects().find((p) => p.name === DEMO_NAME);
if (!project) { console.log("✗ không có project mẫu — bootstrap hỏng, dừng"); process.exit(1); }

// Mọi thứ bài test tạo ra đều vào đây rồi bị xoá ở cuối. D2-BANGIAO §7.8 #5: test ghi thật vào
// store, không tự dọn là mỗi lần chạy để lại một đống rác.
const madeJobs = [], madePresets = [];
const jobsBefore = docgenStore.listJobs(project.id).length;

const newJob = async (over = {}) => {
  const r = await post(`/api/projects/${project.id}/doc-jobs`,
    { standardId: "arc42", name: "zz-regress-" + Math.random().toString(36).slice(2, 7), ...over });
  if (r.body?.job?.id) madeJobs.push(r.body.job.id);
  return r;
};

try {

// ---- A · Catalogue chuẩn (ca 3 · ca 4 · §6 ISO 15289 · §6 văn phong) --------------------------
console.log("\n[A · catalogue chuẩn — số tài liệu, số mục, tooltip]");
{
  const r = await get("/api/doc-standards");
  ok("GET /api/doc-standards → 200", r.status === 200);
  const by = Object.fromEntries((r.body.standards || []).map((s) => [s.id, s]));
  ok("có đủ 5 chuẩn", Object.keys(by).length === 5, Object.keys(by).join(","));

  // Ca 3 của D1: "12 · 9 · 11 · 2/18 · 6/41". Đây là con số chốt, lệch là chuẩn bị sửa nhầm.
  const shape = (id) => by[id] && `${by[id].docs.length}/${by[id].docs.reduce((n, d) => n + d.sections.length, 0)}`;
  ok("arc42 = 1 tài liệu · 12 mục", shape("arc42") === "1/12", shape("arc42"));
  ok("iso29148 = 1 · 9", shape("iso29148") === "1/9", shape("iso29148"));
  ok("ieee1016 = 1 · 11", shape("ieee1016") === "1/11", shape("ieee1016"));
  ok("iso26514 = 2 · 18", shape("iso26514") === "2/18", shape("iso26514"));
  ok("iso15289 = 6 · 41", shape("iso15289") === "6/41", shape("iso15289"));

  // Ca 4: tooltip lấy từ `hint` khai báo — mục không có hint là tooltip rỗng trên giao diện.
  const noHint = [];
  for (const s of r.body.standards)
    for (const d of s.docs) for (const sec of d.sections)
      if (!sec.hint || !String(sec.hint).trim()) noHint.push(`${s.id}/${d.key}/${sec.n}`);
  ok("mọi mục đều có hint cho tooltip", noHint.length === 0, noHint.slice(0, 5).join(", "));

  // §6: giữ 3 mục bổ sung so với bảng 38 mục trong spec.
  const iso = by.iso15289.docs.flatMap((d) => d.sections).map((s) => s.title);
  for (const t of ["Environments and Topology", "Status Accounting and Audit", "Support and Escalation"])
    ok(`iso15289 giữ mục bổ sung "${t}"`, iso.some((x) => x === t), iso.length + " mục");

  // §6: so sánh cả 4 văn phong.
  ok("có đủ 4 văn phong", (r.body.tones || []).length === 4,
    (r.body.tones || []).map((t) => t.id).join(","));
  ok("bộ tuỳ chọn có tài liệu để ghép", (r.body.composable || []).length > 0);

  const e = await get("/api/doc-standards/arc42/estimate");
  ok("dự báo theo chuẩn: đúng số mục", e.body.sections === 12, String(e.body.sections));
  ok("dự báo có ngưỡng hỏi token", typeof e.body.threshold === "number", JSON.stringify(e.body));
}

// ---- B · Tạo bộ tài liệu (ca 1: nguồn chính khoá theo project) --------------------------------
console.log("\n[B · tạo bộ tài liệu — nguồn chính khoá theo project]");
let jobA;
{
  const r = await newJob();
  ok("tạo bộ tài liệu → 200", r.status === 200, JSON.stringify(r.body).slice(0, 120));
  jobA = r.body.job;
  ok("bộ mới ở trạng thái draft", jobA.status === "draft", jobA.status);
  ok("nguồn chính là repo của project, không phải thứ người dùng gõ",
    jobA.sources.main.projectId === project.id && jobA.sources.main.path === project.repo_path,
    JSON.stringify(jobA.sources.main));

  // Ca 1 + §6 "bỏ ＋Thư mục mã nguồn": nguồn thêm LUÔN là tài liệu tham chiếu, không bao giờ là một
  // thân mã nguồn thứ hai. Và đường dẫn không tồn tại thì bị loại thẳng.
  const r2 = await newJob({ sources: { extra: [
    { path: project.repo_path, kind: "source" },          // cố tình khai kind khác
    { path: "Z:/khong-he-ton-tai-" + Date.now() },
  ] } });
  const ex = r2.body.job.sources.extra;
  ok("nguồn thêm: bỏ đường dẫn không tồn tại", ex.length === 1, JSON.stringify(ex));
  ok("nguồn thêm luôn là 'reference', không nhận 'source'", ex[0].kind === "reference", ex[0].kind);

  // §6: độ sâu dàn ý mặc định 2, mở được 3, giá trị vô lý bị kẹp.
  ok("độ sâu mặc định 2 cấp", jobA.style.outlineDepth === 2, String(jobA.style.outlineDepth));
  ok("mở được 3 cấp", (await newJob({ style: { outlineDepth: 3 } })).body.job.style.outlineDepth === 3);
  ok("độ sâu vô lý bị kẹp về 2..3",
    (await newJob({ style: { outlineDepth: 9 } })).body.job.style.outlineDepth === 3);

  const bad1 = await post(`/api/projects/${project.id}/doc-jobs`, { standardId: "khong-co" });
  ok("chuẩn không hợp lệ → 400", bad1.status === 400, String(bad1.status));
  const bad2 = await post(`/api/projects/${project.id}/doc-jobs`, { standardId: "custom", customDocs: [] });
  ok("bộ tuỳ chọn rỗng → 400 kèm lý do riêng",
    bad2.status === 400 && /Chưa chọn tài liệu/.test(bad2.body?.error || ""), JSON.stringify(bad2.body));
  const bad3 = await post("/api/projects/999999/doc-jobs", { standardId: "arc42" });
  ok("project không có → 404", bad3.status === 404, String(bad3.status));
}

// ---- C · Dàn ý không tốn token: preset (ca 8) -------------------------------------------------
console.log("\n[C · preset — dàn ý mà không tiêu token, dùng lại giữa các bộ]");
let presetId, jobB;
{
  // Bộ chưa khảo sát vẫn áp được preset: đây chính là đường đi để chạy hồi quy D1 với 0 token.
  const base = await post(`/api/doc-jobs/${jobA.id}/plan/apply-preset`, { presetId: "khong-co" });
  ok("preset không tồn tại → 404", base.status === 404, String(base.status));

  const sp = await post(`/api/doc-jobs/${jobA.id}/plan/save-preset`, { name: "zz-regress-preset" });
  ok("lưu preset từ bộ chưa có dàn ý → 400", sp.status === 400, String(sp.status));

  // Preset dựng từ HÌNH DẠNG THẬT của chuẩn, không bịa. Hai chi tiết đã làm bài test này sai một
  // lượt, ghi lại để khỏi mắc lại: khoá tài liệu của arc42 là **`sad`**, không phải `"arc42"`; và
  // mục định danh bằng **`num`**, không phải `n`. Sai một trong hai thì `applyPreset` không khớp
  // được mục nào và trả về dàn ý trần của chuẩn — trông vẫn "thành công".
  const std = (await get("/api/doc-standards")).body.standards.find((s) => s.id === "arc42");
  const docKey = std.docs[0].key;
  const nums = std.docs[0].sections.map((s) => s.num);
  ok("khoá tài liệu và số mục của arc42 đúng như chuẩn khai báo",
    docKey === "sad" && nums.length === 12, `${docKey} · ${nums.length}`);

  // Preset chỉ giữ 3 mục đầu, trong đó mục 3 bị TẮT.
  //
  // ⚠ `enabled` và `status` là HAI thứ khác nhau, đừng lẫn:
  //   enabled:false      → người dùng tắt mục trên dàn ý. Đây là thứ mẫu số tiến độ bỏ qua.
  //   status:"skipped"   → dấu ĐÓNG BĂNG, `approvePlan` tự đóng lúc duyệt cho mọi mục đã tắt, và
  //                        `unlock` trả ngược về "pending".
  // Đặt tay `status:"skipped"` mà quên `enabled:false` thì mục vẫn nằm trong mẫu số.
  const mk = await post("/api/doc-presets", {
    name: "zz-regress-preset-goc", standardId: "arc42",
    docs: [{ key: docKey, sections: [
      { num: nums[0], enabled: true }, { num: nums[1], enabled: true }, { num: nums[2], enabled: false },
    ] }],
  });
  ok("tạo preset thẳng → 200", mk.status === 200, JSON.stringify(mk.body).slice(0, 120));
  madePresets.push(mk.body.preset.id);
  ok("thiếu tên/chuẩn → 400", (await post("/api/doc-presets", { name: "x" })).status === 400);

  const ap1 = await post(`/api/doc-jobs/${jobA.id}/plan/apply-preset`, { presetId: mk.body.preset.id });
  ok("áp preset lên bộ chưa khảo sát → 200", ap1.status === 200, String(ap1.status));
  ok("áp preset đẩy bộ từ draft sang chờ duyệt",
    (await get(`/api/doc-jobs/${jobA.id}`)).body.job.status === "plan-review",
    (await get(`/api/doc-jobs/${jobA.id}`)).body.job.status);
  // Mục preset không nhắc tới KHÔNG biến mất — chúng bị đẩy xuống cuối và tắt đi. Mất mục im lặng
  // là kiểu hỏng tệ nhất: người dùng không có cách nào biết mình vừa mất gì.
  ok("mục preset không nhắc tới bị tắt chứ không biến mất",
    ap1.body.stats.total === 12 && ap1.body.stats.sections === 2, JSON.stringify(ap1.body.stats));

  const p1 = await put(`/api/doc-jobs/${jobA.id}/plan`, { plan: ap1.body.plan });
  ok("PUT dàn ý khi chưa duyệt → 200", p1.status === 200, String(p1.status));
  ok("có thống kê kèm theo", p1.body.stats && typeof p1.body.stats.sections === "number",
    JSON.stringify(p1.body.stats));

  // Ca 8: lưu dàn ý của bộ này thành preset rồi áp sang bộ khác. Đây là vòng khứ hồi thật —
  // planToPreset → applyPreset — nên nó bắt được cả lỗi lệch tên trường giữa hai hàm đó.
  const sp2 = await post(`/api/doc-jobs/${jobA.id}/plan/save-preset`, { name: "zz-regress-preset" });
  ok("lưu preset từ bộ đã có dàn ý → 200", sp2.status === 200, JSON.stringify(sp2.body).slice(0, 120));
  presetId = sp2.body.preset.id;
  madePresets.push(presetId);
  ok("preset nhớ chuẩn của bộ gốc", sp2.body.preset.standardId === "arc42", sp2.body.preset.standardId);

  // `jobB` đi ĐÚNG đường thật — draft → áp preset → plan-review — nên phần duyệt/mở khoá ở dưới
  // chạy trên nó.
  jobB = (await newJob()).body.job;
  const ap = await post(`/api/doc-jobs/${jobB.id}/plan/apply-preset`, { presetId });
  ok("áp preset sang bộ khác → 200", ap.status === 200, JSON.stringify(ap.body).slice(0, 120));
  ok("bộ chưa khảo sát vẫn ra dàn ý dùng được", (ap.body.plan?.docs || []).length > 0);
  ok("bộ B sang chờ duyệt",
    (await get(`/api/doc-jobs/${jobB.id}`)).body.job.status === "plan-review");
  ok("preset mang nguyên hình dạng sang bộ B: 2 mục bật / tổng 12, không bật lại sau lưng",
    ap.body.stats.sections === 2 && ap.body.stats.total === 12, JSON.stringify(ap.body.stats));

  // Preset thuộc chuẩn khác thì phải từ chối — áp nhầm là dàn ý lai hai chuẩn, sai từ gốc.
  const other = (await newJob({ standardId: "ieee1016" })).body.job;
  const cross = await post(`/api/doc-jobs/${other.id}/plan/apply-preset`, { presetId });
  ok("preset khác chuẩn → 400 kèm lý do",
    cross.status === 400 && /chuẩn khác/.test(cross.body?.error || ""), JSON.stringify(cross.body));

  // HỒI QUY của D2.1 lên D1: chế độ tiết kiệm chặn KHẢO SÁT, nhưng preset không gọi model nên
  // không được phép bị chặn lây — nếu bị, đường "lấy dàn ý mà không tiêu token" đứt hẳn.
  const before = (await get("/api/agent-settings")).body;
  await put("/api/agent-settings", { economy: { on: true, blockSurvey: true } });
  const jobC = (await newJob()).body.job;
  const blocked = await post(`/api/doc-jobs/${jobC.id}/survey`);
  ok("tiết kiệm chặn khảo sát → 403", blocked.status === 403, String(blocked.status));
  const stillOk = await post(`/api/doc-jobs/${jobC.id}/plan/apply-preset`, { presetId });
  ok("nhưng preset KHÔNG bị chặn lây (nó miễn phí)", stillOk.status === 200,
    `${stillOk.status} ${JSON.stringify(stillOk.body)}`);
  await put("/api/agent-settings", { economy: before.economy });
}

// ---- D · Duyệt, đóng băng, mở khoá (ca 5 · §6) ------------------------------------------------
console.log("\n[D · duyệt dàn ý → đóng băng → mở khoá]");
{
  const before = (await get(`/api/doc-jobs/${jobB.id}`)).body;
  ok("trước khi duyệt: chờ duyệt, chưa đóng băng",
    before.job.status === "plan-review" && !before.plan.approvedAt, before.job.status);

  const ap = await post(`/api/doc-jobs/${jobB.id}/plan/approve`, { engine: "per-section" });
  ok("duyệt → 200", ap.status === 200, JSON.stringify(ap.body).slice(0, 120));
  ok("duyệt → status plan-approved", ap.body.job.status === "plan-approved", ap.body.job.status);
  ok("duyệt → dàn ý có dấu thời gian đóng băng", !!ap.body.plan.approvedAt);
  ok("duyệt nhớ cách chạy đã chọn", ap.body.job.run.engine === "per-section", ap.body.job.run.engine);
  // Ca 5 của D1: mẫu số tiến độ chốt lúc duyệt và KHÔNG đếm mục đã tắt (21 pending / 3 skipped,
  // mẫu số 21). Ở đây là 2 trên tổng 12.
  ok("mẫu số tiến độ KHÔNG đếm mục đã tắt", ap.body.job.metrics.sections === 2,
    String(ap.body.job.metrics.sections));
  // …và mục đã tắt bị đóng băng thành "skipped" ngay lúc duyệt, không đợi tới lúc viết.
  const off = ap.body.plan.docs[0].sections.find((s) => s.enabled === false);
  ok("duyệt đóng băng mục đã tắt thành skipped", off?.status === "skipped", JSON.stringify(off));

  ok("duyệt lần hai → 409", (await post(`/api/doc-jobs/${jobB.id}/plan/approve`)).status === 409);
  const frozen = await put(`/api/doc-jobs/${jobB.id}/plan`, { plan: { docs: [] } });
  ok("sửa dàn ý đã đóng băng → 409 kèm lý do",
    frozen.status === 409 && /đóng băng/.test(frozen.body?.error || ""), JSON.stringify(frozen.body));

  // §6: "🔓 Mở khoá để sửa" — có thật, và nó trả mục đã đóng băng về pending (mẫu số dựng lại).
  const un = await post(`/api/doc-jobs/${jobB.id}/plan/unlock`);
  ok("mở khoá → 200", un.status === 200, String(un.status));
  ok("mở khoá → về chờ duyệt", un.body.job.status === "plan-review", un.body.job.status);
  ok("mở khoá → bỏ dấu đóng băng", !un.body.plan.approvedAt);
  const secs = un.body.plan.docs[0].sections;
  ok("mở khoá → mục skipped trở lại pending", secs.every((s) => s.status !== "skipped"),
    JSON.stringify(secs.map((s) => s.status)));
  ok("sửa lại được sau khi mở khoá",
    (await put(`/api/doc-jobs/${jobB.id}/plan`, { plan: un.body.plan })).status === 200);
  ok("mở khoá khi đang mở → 409", (await post(`/api/doc-jobs/${jobB.id}/plan/unlock`)).status === 409);

  // Chưa có dàn ý thì duyệt cái gì.
  const empty = (await newJob()).body.job;
  ok("duyệt bộ chưa có dàn ý → 400", (await post(`/api/doc-jobs/${empty.id}/plan/approve`)).status === 400);
  ok("viết khi dàn ý chưa duyệt → bị từ chối vì lý do nghiệp vụ",
    /dàn ý/.test((await post(`/api/doc-jobs/${empty.id}/write`)).body?.error || ""));
}

// ---- E · Dữ liệu bền (ca 12) ------------------------------------------------------------------
console.log("\n[E · dữ liệu bền, xoá sạch]");
{
  const j = (await newJob()).body.job;
  await post(`/api/doc-jobs/${j.id}/plan/apply-preset`, { presetId });
  ok("đọc lại từ store thấy đúng dàn ý vừa ghi", !!docgenStore.getPlan(j.id));
  ok("bộ tài liệu thuộc đúng project", Number(docgenStore.getJob(j.id).projectId) === project.id);

  await del(`/api/doc-jobs/${j.id}`);
  madeJobs.splice(madeJobs.indexOf(j.id), 1);
  ok("xoá bộ → job biến mất", !docgenStore.getJob(j.id));
  ok("xoá bộ → dàn ý của nó cũng biến mất, không thành rác mồ côi", !docgenStore.getPlan(j.id));

  ok("bộ không tồn tại → 404", (await get("/api/doc-jobs/dj-khong-co")).status === 404);
  ok("dàn ý của bộ không tồn tại → 404", (await get("/api/doc-jobs/dj-khong-co/plan")).status === 404);
}

} finally {
  // ---- dọn ------------------------------------------------------------------------------------
  console.log("\n[dọn dữ liệu bài test tạo ra]");
  for (const id of madeJobs) await del(`/api/doc-jobs/${id}`).catch(() => {});
  for (const id of madePresets) await del(`/api/doc-presets/${id}`).catch(() => {});
  const after = docgenStore.listJobs(project.id).length;
  ok("số bộ tài liệu của project mẫu về đúng như trước", after === jobsBefore, `${jobsBefore} → ${after}`);
  ok("không để lại preset rác",
    !docgenStore.listPresets().some((p) => p.name?.startsWith("zz-regress")),
    docgenStore.listPresets().map((p) => p.name).join(", "));
  srv.close();
}

console.log(fail ? `\n❌ ${pass} đạt · ${fail} lỗi` : `\n✅ ${pass} đạt · 0 lỗi`);
process.exit(fail ? 1 : 0);
