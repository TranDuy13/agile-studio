// Kiểm router theo hash. Toàn bộ phần LOGIC của router là hàm thuần (slugify / parseHash /
// buildHash / rewriteSeg), nên chạy được thẳng trong node — không cần trình duyệt, không cần jsdom,
// không tiêu token.
//
// `useHashRoute` và `go` cần `window`, và cả module import `react` — nên bài test dựng một
// `globalThis.window` tối thiểu TRƯỚC khi import, đủ để `rewriteSeg` chạy thật.

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${x}`)); };

// window giả: chỉ có hash + replaceState, đúng phần mà rewriteSeg đụng tới.
globalThis.window = {
  location: { hash: "" },
  history: { replaceState: (_a, _b, url) => { globalThis.window.location.hash = String(url); } },
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
};

const R = await import("../web/src/router.js");

// ---- slugify ----------------------------------------------------------------------------------
console.log("\n[slugify — bỏ dấu về ASCII]");
{
  ok("bỏ dấu tiếng Việt", R.slugify("Bộ tài liệu kiến trúc") === "bo-tai-lieu-kien-truc",
    R.slugify("Bộ tài liệu kiến trúc"));
  // đ không phân rã bằng NFD — đây là ca dễ sót nhất khi viết slugify cho tiếng Việt.
  ok("đ/Đ thành d", R.slugify("Đỗ Đức Minh") === "do-duc-minh", R.slugify("Đỗ Đức Minh"));
  ok("đủ dấu tiếng Việt", R.slugify("ăâêôơưỳỹỵ") === "aaeoouyyy", R.slugify("ăâêôơưỳỹỵ"));
  ok("kết quả chỉ còn a-z0-9-", /^[a-z0-9-]*$/.test(R.slugify("Ứng dụng #1 (bản 2.0)!")),
    R.slugify("Ứng dụng #1 (bản 2.0)!"));
  ok("không có gạch thừa ở hai đầu", R.slugify("  --- xin chào --- ") === "xin-chao",
    R.slugify("  --- xin chào --- "));
  ok("cắt ngắn, không để lại gạch cuối", !R.slugify("a".repeat(30) + " " + "b".repeat(30)).endsWith("-"));
  ok("cắt tối đa 40 ký tự", R.slugify("x".repeat(80)).length <= 40);
  ok("tên toàn ký tự lạ → rỗng", R.slugify("！！！") === "", R.slugify("！！！"));
  ok("rỗng/null không vỡ", R.slugify("") === "" && R.slugify(null) === "" && R.slugify(undefined) === "");

  ok("withSlug ghép id-slug", R.withSlug(3, "OneGate") === "3-onegate", R.withSlug(3, "OneGate"));
  ok("withSlug: không slug được thì trả id trần", R.withSlug(3, "！！！") === "3", R.withSlug(3, "！！！"));
  ok("withSlug với id chuỗi (bộ tài liệu)", R.withSlug("dj7x1a", "SAD") === "dj7x1a-sad");
}

// ---- parseHash --------------------------------------------------------------------------------
console.log("\n[parseHash]");
{
  const p = (h) => R.parseHash(h);

  ok("rỗng → chưa chọn project", p("").projectId === null && p("").tab === "flow");
  ok("#/ → chưa chọn project", p("#/").projectId === null);

  const a = p("#/p/3-onegate/sessions");
  ok("đọc id project", a.projectId === 3, String(a.projectId));
  ok("segment sessions → tab flow", a.tab === "flow", a.tab);

  // Đây là chỗ dễ sai nhất: khoá nội bộ `docs` là tab Agile, còn 📚 Tài liệu là `prodocs`.
  ok("segment agile → tab docs (Agile)", p("#/p/3/agile").tab === "docs", p("#/p/3/agile").tab);
  ok("segment docs → tab prodocs (📚 Tài liệu)", p("#/p/3/docs").tab === "prodocs", p("#/p/3/docs").tab);
  ok("segment req", p("#/p/3/req").tab === "req");
  ok("segment sched", p("#/p/3/sched").tab === "sched");
  ok("tab lạ → về tab mặc định", p("#/p/3/khong-co-tab").tab === "flow");

  ok("docs/new → wizard", p("#/p/3/docs/new").view.name === "wizard");
  const o = p("#/p/3-onegate/docs/job/dj7x1a-sad/outline");
  ok("job/…/outline → outline + jobId", o.view.name === "outline" && o.view.jobId === "dj7x1a",
    JSON.stringify(o.view));
  ok("job/…/progress → progress", p("#/p/3/docs/job/dj7x1a/progress").view.name === "progress");
  ok("job không có màn con → outline", p("#/p/3/docs/job/dj7x1a").view.name === "outline");

  // Màn con CHỈ thuộc tab Tài liệu — segment thừa ở tab khác phải bị bỏ qua, không sinh view lạ.
  ok("màn con ở tab khác bị bỏ qua", p("#/p/3/sessions/job/dj7x1a/outline").view.name === "list");

  // Đổi tên = slug khác, id không đổi → link cũ vẫn mở đúng. Đây là lý do chọn dạng id-slug.
  ok("slug cũ vẫn ra đúng id", p("#/p/3-ten-cu-lam-roi/docs").projectId === 3);
  ok("slug bộ tài liệu cũ vẫn ra đúng id",
    p("#/p/3/docs/job/dj7x1a-ten-cu/outline").view.jobId === "dj7x1a");

  // Rác không được làm vỡ, cũng không được nhận nhầm thành một project nào đó.
  ok("id không phải số → coi như chưa chọn", p("#/p/abc/docs").projectId === null);
  ok("thiếu id → chưa chọn", p("#/p").projectId === null && p("#/p/").projectId === null);
  ok("tiền tố lạ → chưa chọn", p("#/xyz/3/docs").projectId === null);
  ok("thừa dấu / không vỡ", p("#//p///3-onegate//docs//").projectId === 3);
  ok("null/undefined không vỡ", p(null).projectId === null && p(undefined).projectId === null);
}

// ---- buildHash --------------------------------------------------------------------------------
console.log("\n[buildHash]");
{
  const b = R.buildHash;
  ok("không project → #/", b({ projectId: null }) === "#/");
  ok("không tham số → #/", b() === "#/");
  ok("project + tab", b({ projectId: 3, projectName: "OneGate", tab: "flow" }) === "#/p/3-onegate/sessions",
    b({ projectId: 3, projectName: "OneGate", tab: "flow" }));
  ok("tab Agile ra segment agile",
    b({ projectId: 3, projectName: "OneGate", tab: "docs" }) === "#/p/3-onegate/agile");
  ok("tab Tài liệu ra segment docs",
    b({ projectId: 3, projectName: "OneGate", tab: "prodocs" }) === "#/p/3-onegate/docs");
  ok("wizard",
    b({ projectId: 3, projectName: "OneGate", tab: "prodocs", view: { name: "wizard" } })
      === "#/p/3-onegate/docs/new");
  ok("outline kèm tên bộ",
    b({ projectId: 3, projectName: "OneGate", tab: "prodocs",
      view: { name: "outline", jobId: "dj7x1a" }, jobName: "SAD" })
      === "#/p/3-onegate/docs/job/dj7x1a-sad/outline");
  ok("progress",
    b({ projectId: 3, projectName: "OneGate", tab: "prodocs",
      view: { name: "progress", jobId: "dj7x1a" }, jobName: "SAD" })
      === "#/p/3-onegate/docs/job/dj7x1a-sad/progress");
  // View của tab Tài liệu không được rò sang tab khác — nếu rò thì bấm tab Sessions vẫn ra URL
  // mang tên một bộ tài liệu.
  ok("view bị bỏ qua ở tab khác",
    b({ projectId: 3, projectName: "OneGate", tab: "flow", view: { name: "outline", jobId: "dj7x1a" } })
      === "#/p/3-onegate/sessions");
  ok("outline thiếu jobId → chỉ còn tab",
    b({ projectId: 3, projectName: "OneGate", tab: "prodocs", view: { name: "outline" } })
      === "#/p/3-onegate/docs");
  ok("tên có dấu ra URL ASCII",
    b({ projectId: 7, projectName: "Cổng dịch vụ công", tab: "prodocs" }) === "#/p/7-cong-dich-vu-cong/docs",
    b({ projectId: 7, projectName: "Cổng dịch vụ công", tab: "prodocs" }));
}

// ---- khứ hồi ----------------------------------------------------------------------------------
console.log("\n[build → parse phải về đúng chỗ cũ]");
{
  const cases = [
    { projectId: 3, projectName: "OneGate", tab: "flow", view: { name: "list", jobId: null } },
    { projectId: 12, projectName: "Bộ tài liệu ✨", tab: "req", view: { name: "list", jobId: null } },
    { projectId: 5, projectName: "UIS", tab: "docs", view: { name: "list", jobId: null } },
    { projectId: 5, projectName: "UIS", tab: "prodocs", view: { name: "wizard", jobId: null } },
    { projectId: 5, projectName: "UIS", tab: "prodocs", view: { name: "outline", jobId: "dj7x1a" }, jobName: "SAD" },
    { projectId: 5, projectName: "UIS", tab: "prodocs", view: { name: "progress", jobId: "dj9z" }, jobName: "SRS" },
  ];
  for (const c of cases) {
    const got = R.parseHash(R.buildHash(c));
    ok(`khứ hồi ${R.buildHash(c)}`,
      got.projectId === c.projectId && got.tab === c.tab
      && got.view.name === c.view.name && (got.view.jobId || null) === (c.view.jobId || null),
      JSON.stringify(got));
  }
}

// ---- rewriteSeg -------------------------------------------------------------------------------
console.log("\n[rewriteSeg — vá slug khi đổi tên]");
{
  const set = (h) => { globalThis.window.location.hash = h; };

  set("#/p/3-ten-cu/docs/job/dj7x1a-bo-cu/outline");
  R.rewriteSeg(R.SEG_PROJECT, "3-ten-moi");
  ok("vá được slug project, GIỮ nguyên phần bộ tài liệu",
    globalThis.window.location.hash === "#/p/3-ten-moi/docs/job/dj7x1a-bo-cu/outline",
    globalThis.window.location.hash);

  R.rewriteSeg(R.SEG_JOB, "dj7x1a-bo-moi");
  ok("vá được slug bộ tài liệu, GIỮ nguyên phần project",
    globalThis.window.location.hash === "#/p/3-ten-moi/docs/job/dj7x1a-bo-moi/outline",
    globalThis.window.location.hash);

  set("#/p/3-onegate/sessions");
  R.rewriteSeg(R.SEG_JOB, "dj1-x");
  ok("segment không tồn tại → không đụng vào", globalThis.window.location.hash === "#/p/3-onegate/sessions",
    globalThis.window.location.hash);

  set("#/");
  R.rewriteSeg(R.SEG_PROJECT, "3-onegate");
  ok("hash không phải dạng /p/… → không đụng vào", globalThis.window.location.hash === "#/",
    globalThis.window.location.hash);

  set("#/p/3-onegate/docs");
  R.rewriteSeg(R.SEG_PROJECT, "3-onegate");
  ok("đã đúng rồi thì không ghi lại", globalThis.window.location.hash === "#/p/3-onegate/docs");
}

console.log(fail ? `\n❌ ${pass} đạt · ${fail} lỗi` : `\n✅ ${pass} đạt · 0 lỗi`);
process.exit(fail ? 1 : 0);
