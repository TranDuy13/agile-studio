// Route theo hash cho Agile Studio.
//
// Vì sao tự viết thay vì react-router: app này chỉ có 5 tab và 3 màn con, và nó được serve tĩnh từ
// `web/dist`. Một router thật kéo theo dependency + phải cấu hình history-fallback ở cả vite dev lẫn
// chỗ serve bản build. Hash không cần gì cả: F5, Back/Forward, dán link — trình duyệt lo hết.
//
// Nguyên tắc quan trọng nhất: **URL là nguồn sự thật duy nhất** cho "đang mở project nào, tab nào,
// màn nào". Trước đây ba thứ đó là `useState` nằm ở hai component khác nhau, nên đổi project mà
// `DocJobs` không remount là nó giữ nguyên dàn ý của project cũ — đúng cái bug này sinh ra để sửa.

import { useEffect, useState } from "react";

// ---- slug ------------------------------------------------------------------------------------

// Bỏ dấu tiếng Việt về ASCII. Slug chỉ để NGƯỜI đọc — app không bao giờ tra cứu theo nó (xem
// `idOf`), nên mất mát thông tin ở đây là vô hại, đổi lại link dán được vào Slack/Jira/terminal mà
// không biến thành một dãy %E1%BB%99 dài gấp ba.
export function slugify(s) {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")   // ề ố ữ… → e o u
    .replace(/[đĐ]/g, "d")                              // đ KHÔNG phân rã bằng NFD — phải map tay
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40).replace(/-+$/, "");
}

// `3` + "OneGate" → "3-onegate". Không có gì slug được thì trả id trần.
export function withSlug(id, name) {
  const s = slugify(name);
  return s ? `${id}-${s}` : String(id);
}

// Đọc ngược: lấy phần trước dấu `-` ĐẦU TIÊN.
// An toàn vì id project là số, còn id bộ tài liệu là "dj" + base36 (server/store/docgen.js) —
// cả hai đều không chứa dấu `-`. Nhờ vậy đổi tên project/bộ thì link cũ vẫn mở đúng.
const idOf = (seg) => String(seg || "").split("-")[0];

// ---- bảng tab --------------------------------------------------------------------------------

// ⚠ Khoá `tab` trong mã lệch với nhãn người dùng thấy, và lệch đúng kiểu dễ sai nhất: `docs` là tab
// **Agile**, còn tab 📚 Tài liệu là `prodocs`. Đây là bảng ánh xạ DUY NHẤT giữa hai thế giới đó —
// đừng dùng thẳng khoá nội bộ làm segment (`#/p/3/prodocs` vừa xấu vừa sai nghĩa).
export const TABS = [
  { seg: "sessions", key: "flow" },
  { seg: "req", key: "req" },
  { seg: "agile", key: "docs" },
  { seg: "docs", key: "prodocs" },
  { seg: "sched", key: "sched" },
];
const DEFAULT_TAB = "flow";
const segOfTab = (key) => TABS.find((t) => t.key === key)?.seg || "sessions";
const tabOfSeg = (seg) => TABS.find((t) => t.seg === seg)?.key || null;

// ---- đọc / ghi hash --------------------------------------------------------------------------

// Bộ URL:
//   #/                                          chưa chọn project
//   #/p/3-onegate/sessions | req | agile | docs | sched
//   #/p/3-onegate/docs/new                      màn tạo bộ tài liệu mới
//   #/p/3-onegate/docs/job/dj7x1a-sad/outline   dàn ý
//   #/p/3-onegate/docs/job/dj7x1a-sad/progress  tiến độ
//
// Mọi đường dẫn không khớp đều rơi về trạng thái mặc định thay vì ném lỗi: URL do người dùng gõ tay
// và do link cũ, sai là chuyện thường, không phải sự cố.
export function parseHash(hash) {
  const parts = String(hash || "").replace(/^#/, "").split("/").filter(Boolean);
  const out = { projectId: null, tab: DEFAULT_TAB, view: { name: "list", jobId: null } };
  if (parts[0] !== "p" || !parts[1]) return out;

  const pid = Number(idOf(parts[1]));
  if (!Number.isFinite(pid) || !parts[1].match(/^\d/)) return out;
  out.projectId = pid;

  const tab = tabOfSeg(parts[2]);
  if (tab) out.tab = tab;

  if (out.tab === "prodocs") {
    if (parts[3] === "new") out.view = { name: "wizard", jobId: null };
    else if (parts[3] === "job" && parts[4])
      out.view = { name: parts[5] === "progress" ? "progress" : "outline", jobId: idOf(parts[4]) };
  }
  return out;
}

export function buildHash({ projectId, projectName, tab, view, jobName } = {}) {
  if (projectId == null) return "#/";
  let p = `#/p/${withSlug(projectId, projectName)}/${segOfTab(tab)}`;
  if (tab === "prodocs" && view) {
    if (view.name === "wizard") p += "/new";
    else if (view.jobId && (view.name === "outline" || view.name === "progress"))
      p += `/job/${withSlug(view.jobId, jobName || view.jobName)}/${view.name}`;
  }
  return p;
}

// Điều hướng. `replace` dùng cho chuyển hướng tự động (link hỏng, khôi phục chỗ cũ) — những thứ đó
// không đáng để lại một mục trong lịch sử trình duyệt, bấm Back sẽ kẹt.
export function go(hash, { replace = false } = {}) {
  const target = hash || "#/";
  if (window.location.hash === target) return;
  if (!replace) { window.location.hash = target; return; }
  window.history.replaceState(null, "", target);
  window.dispatchEvent(new Event("hashchange"));   // replaceState KHÔNG tự phát hashchange
}

// Sửa MỘT segment của hash đang có, im lặng (không phát sự kiện, không thêm lịch sử).
// Dùng để vá lại slug khi tên đổi. Sửa từng segment chứ không dựng lại cả URL: mỗi component chỉ
// biết tên của phần nó quản (App biết tên project, DocJobs biết tên bộ tài liệu) — dựng lại cả URL
// từ một chỗ thiếu thông tin là xoá mất slug của chỗ kia.
export const SEG_PROJECT = 2;
export const SEG_JOB = 5;
export function rewriteSeg(index, want) {
  const parts = window.location.hash.replace(/^#/, "").split("/");
  if (parts[1] !== "p" || parts[index] === undefined || parts[index] === want) return;
  parts[index] = want;
  window.history.replaceState(null, "", "#" + parts.join("/"));
}

// ---- chỗ mở lần trước ------------------------------------------------------------------------

const LAST = "as:lastRoute";
export const rememberRoute = (h) => { try { localStorage.setItem(LAST, h); } catch { /* private mode */ } };
export const lastRoute = () => { try { return localStorage.getItem(LAST) || ""; } catch { return ""; } };

// ---- hook ------------------------------------------------------------------------------------

export function useHashRoute() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return parseHash(hash);
}
