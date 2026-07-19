// Skill tổng (.skill/) + workspace tài liệu agile theo từng project + prompt theo workflow chuẩn.
//
// Kiến trúc tài liệu (2 tầng):
//   1) .skill/<role>.md   : skill dùng chung cho MỌI project (sứ mệnh + trách nhiệm + template
//                           + "Kinh nghiệm tích luỹ" tự học). Tách riêng để push git / public.
//   2) Tài liệu THẬT của project:
//        - Nếu repo project ĐÃ CÓ document/ (vd PSC.Dashboard) -> dùng luôn, đọc & tiếp tục theo đó.
//        - Nếu CHƯA CÓ -> sinh bộ agile chuẩn TỪ .skill/, lưu NGOÀI repo, trong agile-studio này:
//              agile-studio/projects/<slug>/  (KHÔNG tạo document/ trong repo code).
//
// Workflow chuẩn (đặt tên file & mục) đúc kết từ project mẫu PSC.Dashboard.
// Đổi vị trí skill bằng env AGILE_SKILLS_DIR nếu muốn tách hẳn thành repo riêng để publish.
import { mkdirSync, existsSync, writeFileSync, readFileSync, appendFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, basename, resolve } from "node:path";
import { ROLE_ORDER, ROLE_META } from "./runner.js";
import { config } from "./config.js";

const SKILLS_DIR = config.skillsDir;         // thư viện skill tổng (env AGILE_SKILLS_DIR)
const PROJECTS_DIR = config.projectsDir;     // workspace tài liệu managed (env PROJECTS_DIR)
const LEARN_MARK = "<!-- LEARN -->"; // điểm chèn kinh nghiệm học được

// ---------------------------------------------------------------------------
// Workflow chuẩn — đúc kết từ PSC.Dashboard/document/
//   pm/ba/da: file cố định.  dev/qc/po: file theo từng feature (dir + prefix).
// ---------------------------------------------------------------------------
const WORKFLOW = {
  pm: { files: [
    { name: "PM_Tai_Lieu_Yeu_Cau_San_Pham.md", title: "PM — Tài liệu yêu cầu sản phẩm (PRD)",
      sections: ["Bối cảnh & mục tiêu", "Đối tượng người dùng", "Phạm vi / Out-of-scope", "User stories", "Tiêu chí thành công"] },
    { name: "PM_Ke_Hoach_Tinh_Nang.md", title: "PM — Kế hoạch tính năng (Feature Plan)",
      sections: ["Gap analysis (hiện trạng vs cần làm)", "Bản đồ tính năng theo Release", "Chi tiết tính năng", "Kế hoạch sprint", "Truy vết Feature ↔ Release"] },
  ] },
  ba: { files: [
    { name: "BA_Phan_Tich_Nghiep_Vu.md", title: "BA — Phân tích nghiệp vụ & yêu cầu chức năng",
      sections: ["Bối cảnh & mục tiêu", "Phạm vi", "Đối tượng sử dụng (Actors)", "Domain dữ liệu", "Yêu cầu chức năng (FR-##)", "Business rules", "Câu hỏi mở"] },
  ] },
  da: { files: [
    { name: "DA_Thiet_Ke_Giai_Phap.md", title: "DA — Thiết kế giải pháp & dữ liệu",
      sections: ["Nguyên tắc & kiến trúc tổng thể", "Kiến trúc phân lớp", "Thiết kế dữ liệu (model/schema)", "API / interface", "Quyết định kỹ thuật (ADR)", "Rủi ro & phương án"] },
  ] },
  dev: { perFeature: [
    { dir: "features",   prefix: "DEV_", label: "spec",
      sections: ["Phạm vi", "Hiện trạng source & thay đổi", "Quyết định thiết kế", "Chi tiết code", "Kiểm thử & nghiệm thu (DoD)", "Trình tự thực hiện", "Rủi ro & lưu ý"] },
    { dir: "check_list", prefix: "DEV_", label: "checklist",
      sections: ["Đã làm", "Kết quả kiểm thử nghiệm thu", "Vấn đề gặp phải & cách xử lý", "Ghi chú cho team", "Mở đường cho feature kế tiếp"] },
  ] },
  qc: { perFeature: [
    { dir: "qc", prefix: "QC_", label: "report",
      sections: ["Môi trường kiểm chứng", "Kết quả theo feature (đối chiếu DoD)", "So khớp checklist dev", "Ghi chú / khuyến nghị", "Kết luận", "Chạy lại QC"] },
  ] },
  po: { perFeature: [
    { dir: "po", prefix: "BIEN_BAN_NGHIEM_THU_", label: "biên bản nghiệm thu",
      sections: ["Kết luận tổng thể", "Phương pháp & phạm vi nghiệm thu", "Bảng nghiệm thu từng feature", "Đối chiếu yêu cầu chức năng (BA)", "Phát hiện & khuyến nghị", "Kết luận & việc cần làm", "Xác nhận"] },
  ] },
};
const SUBDIRS = ["features", "check_list", "qc", "po"];

// ---------------------------------------------------------------------------
// Seed skill tổng (.skill/)
// ---------------------------------------------------------------------------
const SEED = {
  pm:  { mission: "Xác định vấn đề, mục tiêu, phạm vi và độ ưu tiên của sản phẩm.",
         responsibilities: ["Viết PRD & Feature Plan", "Định nghĩa user stories", "Đặt tiêu chí thành công / DoD"] },
  ba:  { mission: "Chuyển yêu cầu sản phẩm thành yêu cầu nghiệp vụ rõ ràng, kiểm chứng được.",
         responsibilities: ["Mô tả luồng nghiệp vụ & actors", "Yêu cầu chức năng FR-##", "Business rules, dữ liệu & ràng buộc"] },
  da:  { mission: "Thiết kế giải pháp kỹ thuật đáp ứng yêu cầu nghiệp vụ.",
         responsibilities: ["Kiến trúc & phân lớp", "Thiết kế dữ liệu / API", "Quyết định kỹ thuật (ADR) & rủi ro"] },
  dev: { mission: "Hiện thực feature theo thiết kế, có test và hướng dẫn chạy.",
         responsibilities: ["Feature spec", "Code thật theo thiết kế DA", "Build/test + checklist hoàn thành"] },
  qc:  { mission: "Đảm bảo chất lượng: đối chiếu DoD, chạy test, báo lỗi.",
         responsibilities: ["Test theo DoD", "Đối chiếu checklist dev", "Report & ghi nhận bug"] },
  po:  { mission: "Nghiệm thu sản phẩm theo tiêu chí, ra quyết định chấp nhận.",
         responsibilities: ["Biên bản nghiệm thu", "Đối chiếu yêu cầu BA", "Phát hiện & khuyến nghị"] },
};

function skillPath(id) { return join(SKILLS_DIR, `${id}.md`); }

// Template đầu ra của skill = mục tiêu chuẩn của các file role phụ trách trong workflow.
function skillTemplate(id) {
  const w = WORKFLOW[id];
  if (w.files) return w.files.map((f) => `**${f.name}**\n` + f.sections.map((s) => `- ${s}`).join("\n")).join("\n\n") + "\n";
  return w.perFeature.map((f) => `**${f.dir}/${f.prefix}<feature>.md** (${f.label})\n` + f.sections.map((s) => `- ${s}`).join("\n")).join("\n\n") + "\n";
}

function seedSkillContent(id) {
  const m = ROLE_META[id], s = SEED[id];
  const resp = s.responsibilities.map((r) => `- ${r}`).join("\n");
  return `# Skill: ${m.emoji} ${m.name}

**Sứ mệnh:** ${s.mission}

## Trách nhiệm
${resp}

## Template tài liệu đầu ra
${skillTemplate(id)}
## Kinh nghiệm tích luỹ
${LEARN_MARK}
`;
}

function overviewContent() {
  const rows = ROLE_ORDER.map((id) => `| ${ROLE_META[id].emoji} ${ROLE_META[id].name} | [${id}.md](./${id}.md) |`).join("\n");
  return `# Thư viện Skill tổng — Agile Studio

Skill dùng chung cho MỌI project theo quy trình **PM → BA → DA → Dev → QC → PO**.
Project mới sẽ sinh bộ tài liệu chuẩn TỪ đây (lưu ngoài repo, trong \`agile-studio/projects/<slug>/\`);
sau mỗi feature hoàn tất, phần "Kinh nghiệm tích luỹ" của từng skill được cập nhật (tự học).

| Role | Skill |
|------|-------|
${rows}
`;
}

function readmeContent() {
  return `# Agile Studio — Skill Pack

Thư viện skill tổng cho quy trình **PM → BA → DA → Dev → QC → PO**.
Folder độc lập, có thể **push git** hoặc **publish** để tái dùng cho nhiều project.

- Mỗi \`<role>.md\` = sứ mệnh, trách nhiệm, template tài liệu đầu ra, và "Kinh nghiệm tích luỹ" (tự cập nhật).
- Project chưa có tài liệu sẽ được sinh bộ agile chuẩn từ các skill này.

Xem [_overview.md](./_overview.md).
`;
}

// Đảm bảo thư viện skill tổng tồn tại (seed nếu trống). Trả về file vừa tạo.
export function ensureSkillLibrary() {
  mkdirSync(SKILLS_DIR, { recursive: true });
  const created = [];
  for (const id of ROLE_ORDER)
    if (!existsSync(skillPath(id))) { writeFileSync(skillPath(id), seedSkillContent(id)); created.push(`.skill/${id}.md`); }
  const ov = join(SKILLS_DIR, "_overview.md");
  if (!existsSync(ov)) { writeFileSync(ov, overviewContent()); created.push(".skill/_overview.md"); }
  const rm = join(SKILLS_DIR, "README.md");
  if (!existsSync(rm)) { writeFileSync(rm, readmeContent()); created.push(".skill/README.md"); }
  return created;
}

// Nội dung skill (bỏ mục "Kinh nghiệm tích luỹ" cho gọn) để nhồi vào prompt.
export function readSkill(id) {
  ensureSkillLibrary();
  try {
    const txt = readFileSync(skillPath(id), "utf8");
    const cut = txt.indexOf("## Kinh nghiệm");
    return (cut > 0 ? txt.slice(0, cut) : txt).trim();
  } catch { return ""; }
}

// ---------------------------------------------------------------------------
// Workspace tài liệu theo project
// ---------------------------------------------------------------------------
function noDiacritics(s) {
  return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D");
}
function slugify(s) {
  return noDiacritics(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "project";
}
// Rút "mã feature" F## nếu nhận diện được (DEV_06 / F6 / F-06 / feature 6 / tính năng 6…),
// chuẩn hoá thành F06, kèm tên ngắn nếu còn. Không có số -> slug cả câu (bỏ dấu) như cũ.
export function featureSlug(s) {
  const raw = noDiacritics(s || "").trim();
  // ưu tiên số đi sau marker f/dev/feat/feature/"tinh nang"; nếu không có thì lấy số đứng riêng
  let m = raw.match(/\b(?:f|dev|feat|feature|tinh\s*nang)\s*[_-]?\s*0*(\d{1,3})\b/i)
       || raw.match(/\b0*(\d{1,3})\b/);
  if (m) {
    const code = "F" + String(m[1]).padStart(2, "0");
    const name = raw.replace(m[0], " ")
      .replace(/\b(?:f|dev|feat|feature|tinh\s*nang|lam|cho|va|the)\b/gi, " ")
      .replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30);
    return name ? `${code}_${name}` : code;
  }
  return raw.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50) || "feature";
}

function workspaceReadme(projectName, slug) {
  return `# Tài liệu agile — ${projectName}

Workspace do Agile Studio quản lý (NGOÀI repo code). Sinh từ \`.skill/\` theo workflow chuẩn.

\`\`\`
projects/${slug}/
  PM_Tai_Lieu_Yeu_Cau_San_Pham.md   PM_Ke_Hoach_Tinh_Nang.md
  BA_Phan_Tich_Nghiep_Vu.md
  DA_Thiet_Ke_Giai_Phap.md
  features/     DEV_<feature>.md   (spec)
  check_list/   DEV_<feature>.md   (checklist)
  qc/           QC_<feature>.md
  po/           BIEN_BAN_NGHIEM_THU_<feature>.md
\`\`\`
`;
}

// Xác định nơi chứa tài liệu agile của project:
//  - repo đã có document/*.md  -> mode "repo"   (dùng luôn, đọc & tiếp tục theo đó)
//  - chưa có                    -> mode "managed" (sinh bộ chuẩn từ .skill/ trong agile-studio/projects/<slug>)
// Trả về { docsDir, mode, slug, created }.
export function resolveWorkspace(repo, projectName) {
  ensureSkillLibrary();
  const repoDocs = join(repo, "document");
  const hasRepoDocs = existsSync(repoDocs) && readdirSync(repoDocs).some((f) => f.endsWith(".md"));
  if (hasRepoDocs) return { docsDir: repoDocs, mode: "repo", slug: slugify(projectName), created: [] };

  const slug = slugify(projectName);
  const dir = join(PROJECTS_DIR, slug);
  const created = [];
  mkdirSync(dir, { recursive: true });
  for (const sub of SUBDIRS) mkdirSync(join(dir, sub), { recursive: true });
  // CHỦ Ý: không seed sẵn PM/BA/DA — để agent tự tạo (nếu seed, economy sẽ auto-skip nhầm ngay lần đầu).
  // README làm bản đồ cấu trúc + quy ước đặt tên để agent theo.
  const rm = join(dir, "README.md");
  if (!existsSync(rm)) { writeFileSync(rm, workspaceReadme(projectName, slug)); created.push(`projects/${slug}/README.md`); }
  return { docsDir: dir, mode: "managed", slug, created };
}

// Đường dẫn TUYỆT ĐỐI các file đầu ra của role cho 1 feature (dùng khi cần tên file cụ thể).
export function roleOutputPaths(roleId, feature, docsDir) {
  const w = WORKFLOW[roleId];
  const fslug = featureSlug(feature);
  if (w.files) return w.files.map((f) => join(docsDir, f.name));
  return w.perFeature.map((f) => join(docsDir, f.dir, `${f.prefix}${fslug}.md`));
}

// Prefix tài liệu theo role (đúng quy ước PSC.Dashboard: PM_/BA_/DA_…).
const ROLE_PREFIX = { pm: "PM_", ba: "BA_", da: "DA_" };
const PERFEATURE_DIRS = { dev: ["features", "check_list"], qc: ["qc"], po: ["po"] };

// Mã feature F## (nếu có) để so tên file per-feature không phụ thuộc tên đầy đủ.
export function featureCode(feature) {
  const m = String(featureSlug(feature)).match(/^F\d{2,3}/);
  return m ? m[0] : null;
}

function listByPrefix(docsDir, pre) {
  try { return readdirSync(docsDir).filter((f) => f.startsWith(pre) && f.endsWith(".md")); }
  catch { return []; }
}
function listFeatureDocs(docsDir, sub, code, fslug) {
  try {
    return readdirSync(join(docsDir, sub))
      .filter((f) => f.endsWith(".md") && (f.includes(fslug) || (code && f.toUpperCase().includes(code))))
      .map((f) => `${sub}/${f}`);
  } catch { return []; }
}

// Tài liệu của 1 role cho feature này, ưu tiên FILE THẬT trên đĩa (bền với tên biến thể).
// fallback=true: nếu chưa có thì trả tên chuẩn (để role tự tạo). fallback=false: chỉ file thật.
function roleDocs(roleId, docsDir, feature, fallback = true) {
  const w = WORKFLOW[roleId];
  const code = featureCode(feature), fslug = featureSlug(feature);
  if (w.files) {
    const real = listByPrefix(docsDir, ROLE_PREFIX[roleId]);
    return real.length ? real : (fallback ? w.files.map((f) => f.name) : []);
  }
  const out = [];
  for (const f of w.perFeature) {
    const real = listFeatureDocs(docsDir, f.dir, code, fslug);
    if (real.length) out.push(...real);
    else if (fallback) out.push(`${f.dir}/${f.prefix}${fslug}.md`);
  }
  return out;
}

// role ĐÃ CÓ tài liệu đầu ra chưa? — dùng cho auto-skip (economy).
//  pm/ba/da : có BẤT KỲ file nào mang prefix role (bền với tên biến thể như DA_Thiet_Ke_Data_Warehouse.md).
//  dev/qc/po: mọi thư mục của role đều có 1 file khớp mã F## (hoặc đúng slug feature).
export function roleHasOutputs(roleId, feature, docsDir) {
  if (!existsSync(docsDir)) return false;
  const pre = ROLE_PREFIX[roleId];
  if (pre) {
    try { return readdirSync(docsDir).some((f) => f.startsWith(pre) && f.endsWith(".md")); }
    catch { return false; }
  }
  const code = featureCode(feature);
  const fslug = featureSlug(feature);
  return (PERFEATURE_DIRS[roleId] || []).every((sub) => {
    const d = join(docsDir, sub);
    if (!existsSync(d)) return false;
    let files; try { files = readdirSync(d); } catch { return false; }
    return files.some((f) => f.endsWith(".md") &&
      (f.includes(fslug) || (code && f.toUpperCase().includes(code))));
  });
}

// Prompt cho 1 role theo workflow chuẩn: nhồi skill từ .skill/, chỉ rõ đọc/ghi ở đâu.
const UPSTREAM = { pm: [], ba: ["pm"], da: ["ba"], dev: ["pm", "ba", "da"], qc: ["da", "dev"], po: ["qc", "pm"] };

export function buildRolePrompt(roleId, feature, isFirst, ctx) {
  const meta = ROLE_META[roleId];
  const skill = readSkill(roleId);

  // Đầu vào = tài liệu THẬT của các role trước (chỉ file có trên đĩa, khử trùng lặp).
  const upstream = [...new Set(UPSTREAM[roleId].flatMap((r) => roleDocs(r, ctx.docsDir, feature, false)))];
  // Đầu ra = tài liệu của role này: có file thật thì cập nhật đúng file đó, chưa có thì tạo tên chuẩn.
  const own = roleDocs(roleId, ctx.docsDir, feature, true);

  const loc = ctx.mode === "repo"
    ? `Project ĐÃ CÓ sẵn tài liệu agile tại: ${ctx.docsDir}\n`
      + `-> ĐỌC các file .md hiện có ở đó, TUÂN THEO đúng cấu trúc & quy ước đặt tên của chúng, `
      + `rồi CẬP NHẬT / BỔ SUNG cho feature này (không tạo lại từ đầu, không đổi cấu trúc).`
    : `Tài liệu agile của project được quản lý NGOÀI repo tại: ${ctx.docsDir}\n`
      + `-> Đọc/ghi tài liệu ở thư mục đó theo đúng tên file chuẩn. `
      + `TUYỆT ĐỐI KHÔNG tạo thư mục document/ bên trong repo code.`;

  const reads = upstream.length
    ? `Đầu vào cần đọc trước (file thật đang có): ${upstream.join(", ")}.`
    : (roleId === "pm"
        ? `Đây là bước mở đầu — chưa có tài liệu đầu vào bắt buộc.`
        : `Chưa thấy tài liệu thượng nguồn trên đĩa.`);
  // Thiếu hẳn đầu vào thượng nguồn (vd tắt/skip PM/BA/DA mà file chưa có) -> nhắc tự phác thảo để không kẹt.
  const missingNote = (roleId !== "pm" && upstream.length === 0)
    ? `\nLƯU Ý: chưa có tài liệu PM/BA/DA — hãy TỰ phác thảo ngắn phần phân tích/thiết kế cần thiết `
      + `${roleId === "dev" ? "ngay trong spec trước khi code" : "trước khi làm phần của bạn"}, đừng bỏ trống.`
    : "";
  const writes = `Đầu ra bạn phải tạo/cập nhật: ${own.join(", ")}.`;

  const noteBlock = ctx.note ? `\n=== YÊU CẦU / GHI CHÚ ƯU TIÊN ===\n${ctx.note}\n=== HẾT ===\n` : "";

  return [
    `Bạn đảm nhận vai trò ${meta.emoji} ${meta.name} trong quy trình Agile/Scrum (PM → BA → DA → Dev → QC → PO).`,
    `Thư mục làm việc hiện tại (cwd) là REPO CODE của project — chỉ đọc/sửa CODE ở đây.`,
    loc,
    noteBlock,
    `=== SKILL ${meta.name} (từ .skill/${roleId}.md) ===`,
    skill,
    `=== HẾT SKILL ===`,
    ``,
    reads + missingNote,
    writes,
    ``,
    `Feature cần xử lý: "${feature}".`,
    `Chỉ làm đúng phần ${meta.name}; tôn trọng đầu ra của các vai trò trước. Dùng đường dẫn tuyệt đối tới thư mục tài liệu nêu trên khi ghi file.`,
    `TIẾT KIỆM TOKEN: chỉ đọc đúng các file đầu vào liệt kê ở trên, KHÔNG quét/đọc toàn bộ repo; `
      + `chỉ thêm/sửa phần liên quan trực tiếp tới feature này, KHÔNG viết lại nội dung cũ; đi thẳng vào việc, không giải thích dài dòng.`,
  ].join("\n");
}

// "Tự học lại": sau khi xong feature, ghi kinh nghiệm vào skill tổng của các role đã chạy.
export function learnFromRun(projectName, feature, rolesRun, status = "done") {
  ensureSkillLibrary();
  const stamp = new Date().toISOString().slice(0, 10);
  const mark = status === "done" ? "✅" : "⏸";
  const note = `- ${mark} \`${stamp}\` [${projectName}] ${feature || "(không mô tả)"}`;
  const learned = [];
  for (const id of rolesRun) {
    const p = skillPath(id);
    if (!existsSync(p)) writeFileSync(p, seedSkillContent(id));
    const txt = readFileSync(p, "utf8");
    if (txt.includes(LEARN_MARK)) writeFileSync(p, txt.replace(LEARN_MARK, `${note}\n${LEARN_MARK}`));
    else appendFileSync(p, `\n${note}\n`);
    learned.push(`.skill/${id}.md`);
  }
  return learned;
}

// Cho UI xem thư viện skill tổng.
export function listSkills() {
  ensureSkillLibrary();
  return readdirSync(SKILLS_DIR).filter((f) => f.endsWith(".md")).map((f) => ({
    file: f, content: readFileSync(join(SKILLS_DIR, f), "utf8"),
  }));
}
// Lưu 1 file skill đã sửa từ UI.
export function saveSkill(file, content) {
  ensureSkillLibrary();
  const name = basename(String(file));
  if (!name.endsWith(".md")) throw new Error("Chỉ sửa file .md");
  const fp = join(SKILLS_DIR, name);
  if (!existsSync(fp)) throw new Error("Không thấy skill");
  writeFileSync(fp, String(content));
  return { file: name };
}

// ---- Xem/sửa tài liệu project (docsDir) ----
export function listDocs(docsDir) {
  if (!existsSync(docsDir)) return [];
  const out = [];
  const walk = (dir, prefix, depth) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (ent.name.startsWith(".")) continue;
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      const full = join(dir, ent.name);
      if (ent.isDirectory()) { if (depth < 4 && ent.name !== "node_modules") walk(full, rel, depth + 1); }
      else { try { out.push({ path: rel, size: statSync(full).size }); } catch {} }
    }
  };
  walk(docsDir, "", 0);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
function safeDocPath(docsDir, rel) {
  const full = resolve(join(docsDir, String(rel)));
  if (!full.startsWith(resolve(docsDir))) throw new Error("Đường dẫn không hợp lệ");
  return full;
}
export function readDoc(docsDir, rel) {
  const fp = safeDocPath(docsDir, rel);
  if (!existsSync(fp)) throw new Error("Không thấy file");
  return readFileSync(fp, "utf8");
}
export function writeDoc(docsDir, rel, content) {
  const fp = safeDocPath(docsDir, rel);
  mkdirSync(dirname(fp), { recursive: true });
  writeFileSync(fp, String(content));
  return { path: rel };
}
