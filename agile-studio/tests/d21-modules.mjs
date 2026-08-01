// Kiểm thử module, KHÔNG khởi động server thứ hai (bẫy §6 #6).
// Chỉ chạm: docgen-work/<fake-id>/run.log, dataDir/demo/stale-demo — server đang chạy không đọc.
const APP = "../server/";
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

// ---- economy.js -----------------------------------------------------------------------------
console.log("\n[economy.js]");
{
  const { ECONOMY_DEFAULTS, normalizeEconomy, economyOf, modelFor, capTargets, priceFactor,
    DEV_LOCK_ECONOMY, LOCK_REASON } = await import(APP + "docgen/economy.js");

  // Giai đoạn phát triển: một công tắc duy nhất, ép mọi lượt về cấu hình rẻ nhất.
  ok("có công tắc DEV_LOCK_ECONOMY", typeof DEV_LOCK_ECONOMY === "boolean");
  ok("mặc định `on` đi theo công tắc", ECONOMY_DEFAULTS.on === DEV_LOCK_ECONOMY);

  // Bật tường minh: mặc định `on` đi theo DEV_LOCK_ECONOMY, mà bản ship đã tắt lock nên phải bật
  // rõ ràng ở đây để kiểm đúng hành vi "economy đang bật", không phụ thuộc giá trị mặc định.
  const eOn = economyOf({ economy: { ...ECONOMY_DEFAULTS, on: true } });
  ok("bật → có model haiku", /haiku/.test(eOn.model), eOn.model);
  ok("bật → prompt rút gọn", eOn.shortPrompt === true);
  ok("bật → không chặn khảo sát (mặc định)", eOn.blockSurvey === false);
  ok("notes người đọc được", eOn.notes.length >= 3, JSON.stringify(eOn.notes));

  if (DEV_LOCK_ECONOMY) {
    // Đang ép: thiết lập của người dùng KHÔNG được lọt qua, và UI phải biết là đang bị khoá.
    ok("ép → cap 1 mục (rẻ nhất)", eOn.maxSections === 1, String(eOn.maxSections));
    ok("ép → báo locked cho UI", eOn.locked === true);
    ok("ép → có lý do hiện cho người dùng", eOn.lockReason === LOCK_REASON && !!LOCK_REASON);
    ok("ép → lý do nói rõ xong issue thì tắt", /xong hết issue/i.test(LOCK_REASON), LOCK_REASON);

    // Đây là điều quan trọng nhất của việc ép: người dùng tắt cũng không có tác dụng.
    const tryOff = economyOf({ economy: { ...ECONOMY_DEFAULTS, on: false } });
    ok("ép → người dùng TẮT cũng vẫn bật", tryOff.on === true && tryOff.locked === true);
    const tryLoose = economyOf({ economy: { ...ECONOMY_DEFAULTS,
      forceModel: false, capSections: false, shortPrompt: false, maxSectionsPerRun: 40 } });
    ok("ép → nới từng nút cũng không lọt",
      /haiku/.test(tryLoose.model) && tryLoose.maxSections === 1 && tryLoose.shortPrompt === true,
      JSON.stringify(tryLoose));
    // blockSurvey KHÔNG bị ép: nó tắt tính năng, không làm rẻ hơn, và luồng khảo sát còn phải kiểm.
    const wantSurvey = economyOf({ economy: { ...ECONOMY_DEFAULTS, blockSurvey: true } });
    ok("ép → blockSurvey vẫn theo người dùng", wantSurvey.blockSurvey === true);
  } else {
    // Đã mở khoá (ship): tắt phải tắt SẠCH, không sót nút nào còn tác dụng.
    ok("mở khoá → mặc định TẮT để người dùng dùng thoải mái", ECONOMY_DEFAULTS.on === false);
    const eOff = economyOf({ economy: { ...ECONOMY_DEFAULTS, on: false } });
    ok("tắt → model null", eOff.model === null);
    ok("tắt → không cap", eOff.maxSections === null);
    ok("tắt → prompt đầy đủ", eOff.shortPrompt === false);
    ok("tắt → không báo locked", eOff.locked === false);
    ok("modelFor: tắt thì dùng cài đặt chung", modelFor(eOff, "claude-opus-5") === "claude-opus-5");
    ok("capTargets không cắt khi tắt", capTargets([1, 2, 3, 4, 5].map((n) => ({ n })), eOff).targets.length === 5);
    ok("priceFactor = 1 khi tắt", priceFactor(eOff) === 1);
    const only = economyOf({ economy: { ...ECONOMY_DEFAULTS, on: true, forceModel: false } });
    ok("mở khoá → tắt riêng forceModel có tác dụng", only.model === null);
  }

  ok("modelFor: tiết kiệm thắng cài đặt chung", modelFor(eOn, "claude-opus-5") === eOn.model);

  const ts = [1, 2, 3, 4, 5].map((n) => ({ n }));
  const c = capTargets(ts, eOn);
  ok("capTargets cắt đúng theo cap", c.targets.length === eOn.maxSections
    && c.deferred === ts.length - eOn.maxSections, JSON.stringify(c.targets) + " " + c.deferred);
  ok("capTargets giữ nguyên khi ít hơn cap", capTargets([{ n: 1 }], eOn).deferred === 0);
  ok("priceFactor < 1 khi rút gọn", priceFactor(eOn) < 1, String(priceFactor(eOn)));

  // Chuẩn hoá từ HTTP: rác không được bật/tắt được gì. Đây là thiết lập ĐÃ LƯU (giữ nguyên để lúc
  // mở khoá thì dùng lại được), không phải thiết lập đang có hiệu lực.
  const n1 = normalizeEconomy({ maxSectionsPerRun: 999 }, ECONOMY_DEFAULTS);
  ok("normalize kẹp cap ≤ 50", n1.maxSectionsPerRun === 50, String(n1.maxSectionsPerRun));
  const n2 = normalizeEconomy({ maxSectionsPerRun: -5 }, ECONOMY_DEFAULTS);
  ok("normalize kẹp cap ≥ 1", n2.maxSectionsPerRun === 1);
  const n3 = normalizeEconomy({ on: "co" }, ECONOMY_DEFAULTS);
  ok("normalize bỏ qua kiểu sai", n3.on === ECONOMY_DEFAULTS.on);
  const n4 = normalizeEconomy({ shortPrompt: false }, ECONOMY_DEFAULTS);
  ok("normalize patch một phần giữ phần còn lại",
    n4.shortPrompt === false && n4.maxSectionsPerRun === ECONOMY_DEFAULTS.maxSectionsPerRun);
}

// ---- runner.js describe (qua runClaude verbose là không thực tế, test describe qua export) ----
console.log("\n[runner.js — verbose detail]");
{
  // describe() không export; kiểm gián tiếp: chắc chắn runClaude nhận tham số verbose.
  const here = (await import("node:path")).dirname((await import("node:url")).fileURLToPath(import.meta.url));
  const src = await (await import("node:fs")).promises.readFile(
    (await import("node:path")).join(here, "..", "server", "runner.js"), "utf8");
  ok("runClaude có tham số verbose", /export function runClaude\([^)]*verbose = false/s.test(src));
  ok("describe nhận verbose", /function describe\(ev, verbose = false\)/.test(src));
  ok("phát kind stderr", /kind: "stderr"/.test(src));
  ok("phát kind exit kèm code", /kind: "exit"[\s\S]{0,200}code/.test(src));
  ok("phát kind spawn kèm prompt", /kind: "spawn"/.test(src) && /--- prompt ---/.test(src));
  ok("bắt tool_result", /tool_result/.test(src));
  ok("text vẫn cắt 400 cho thanh trạng thái", /slice\(0, 400\)/.test(src));
  ok("detail giữ tới 8000", /MAX_DETAIL = 8000/.test(src));
  // Quan trọng: mặc định TẮT để index.js/bot.js không bị nhiễu kind mới.
  ok("mặc định verbose tắt", /verbose = false/.test(src));
}

// ---- runlog.js ------------------------------------------------------------------------------
console.log("\n[runlog.js]");
{
  const runlog = await import(APP + "docgen/runlog.js");
  const JOB = "zz-test-" + Date.now().toString(36);
  runlog.clearLog(JOB);

  const { runId } = runlog.beginRun(JOB, { stage: "write", engine: "per-doc" });
  ok("beginRun trả runId", typeof runId === "string" && runId.startsWith("write-"), String(runId));

  runlog.log(JOB, { stage: "write", session: "sad", kind: "tool", text: "📖 đọc README.md",
    detail: '{"file_path":"README.md"}' });
  runlog.log(JOB, { stage: "write", session: "sad", kind: "stderr", text: "Error: boom",
    detail: "Error: boom\n  at x" });
  runlog.log(JOB, { stage: "write", session: "srs", kind: "exit", text: "✖ phiên thoát 1", code: 1 });
  runlog.endRun(JOB, { stage: "write", ok: false, text: "■ hết lượt" });

  const r = runlog.readLog(JOB);
  ok("đọc lại đủ 5 dòng", r.entries.length === 5, String(r.entries.length));
  ok("có seq tăng dần", r.entries.every((e, i) => e.seq === i + 1));
  ok("giữ detail nguyên vẹn", r.entries.find((e) => e.kind === "stderr").detail.includes("at x"));
  ok("giữ code thoát", r.entries.find((e) => e.kind === "exit")?.code === 1);
  ok("liệt kê session", r.sessions.includes("sad") && r.sessions.includes("srs"), JSON.stringify(r.sessions));
  ok("liệt kê run", r.runs.includes(runId));

  ok("lọc theo session", runlog.readLog(JOB, { session: "sad" }).entries.length === 2);
  const prob = runlog.readLog(JOB, { kind: "problem" });
  ok("lọc problem lấy stderr+exit+run-error", prob.entries.length === 3,
    JSON.stringify(prob.entries.map((e) => e.kind)));
  ok("after=3 chỉ lấy dòng mới", runlog.readLog(JOB, { after: 3 }).entries.length === 2);

  const txt = runlog.renderLogText(JOB);
  ok("bản .log có thụt lề detail", txt.includes("    │ "), txt.slice(0, 200));
  ok("bản .log có header", txt.includes("# Log phiên agent"));

  ok("lastMeaningful bỏ dòng run", runlog.lastMeaningful(JOB).every((e) => e.kind !== "run"));

  // Quan trọng nhất cho ca 11: log phải đọc lại được từ ĐĨA sau khi mất cache trong RAM.
  const fresh = await import(APP + "docgen/runlog.js?reload=" + Date.now());
  const afterRestart = fresh.readLog(JOB);
  ok("SỐNG SÓT restart: đọc lại từ đĩa", afterRestart.entries.length === 5,
    String(afterRestart.entries.length));
  ok("SỐNG SÓT restart: detail vẫn còn", afterRestart.entries.find((e) => e.kind === "stderr").detail.includes("at x"));

  runlog.clearLog(JOB);
  ok("clearLog dọn sạch", runlog.readLog(JOB).entries.length === 0);

  // Log là tệp CỤC BỘ còn job có thể đến từ database dùng chung (nhánh local-work). Bốn lý do khác
  // nhau cho "không có dòng nào" phải phân biệt được, nếu không người dùng tưởng tính năng hỏng.
  const J2 = "zz-state-" + Date.now().toString(36);
  runlog.clearLog(J2);
  ok("chưa chạy lần nào → never",
    runlog.logState(J2, { ran: false }).state === "never", runlog.logState(J2, { ran: false }).state);
  ok("đã chạy, không có tệp, cùng máy → missing",
    runlog.logState(J2, { ran: true, ranHost: runlog.HOST }).state === "missing");
  ok("đã chạy, không có tệp, máy khác → other-host",
    runlog.logState(J2, { ran: true, ranHost: "may-khac-01" }).state === "other-host");
  ok("other-host giữ tên máy để hiện cho người dùng",
    runlog.logState(J2, { ran: true, ranHost: "may-khac-01" }).ranHost === "may-khac-01");
  ok("job cũ không có logHost → missing chứ không bịa máy",
    runlog.logState(J2, { ran: true, ranHost: null }).state === "missing");

  const started = runlog.beginRun(J2, { stage: "write" });
  ok("beginRun trả runId + host + file",
    !!started.runId && started.host === runlog.HOST && started.file.endsWith("run.log"),
    JSON.stringify(started));
  ok("có tệp rồi → ok", runlog.logState(J2, { ran: true, ranHost: runlog.HOST }).state === "ok");
  ok("state ok kèm kích thước", runlog.logState(J2, { ran: true }).bytes > 0);
  ok("log ghi lại cả máy đã chạy",
    runlog.readLog(J2).entries[0].detail.includes(runlog.HOST));
  runlog.clearLog(J2);
}

// ---- dests.js: nơi lưu sẵn khi xuất ----------------------------------------------------------
console.log("\n[dests.js — nơi lưu khi xuất]");
{
  const dests = await import(APP + "docgen/dests.js");
  const { existsSync } = await import("node:fs");

  const list = dests.destCandidates();
  ok("có đúng 2 nơi lưu sẵn", list.length === 2, String(list.length));
  ok("KHÔNG còn nút 'Thư mục dữ liệu Studio'", !list.some((d) => d.id === "data"),
    JSON.stringify(list.map((d) => d.id)));
  ok("mỗi nơi có id/label/path/hint",
    list.every((d) => d.id && d.label && d.path && d.hint), JSON.stringify(list.map((d) => d.id)));
  ok("có đúng một nơi được đề xuất mặc định",
    list.filter((d) => d.preferred).length === 1);
  ok("nơi đề xuất là thư mục trong repo", list.find((d) => d.preferred).id === "repo");
  ok("đường dẫn đều tuyệt đối", list.every((d) => /^([a-zA-Z]:[\\/]|\/)/.test(d.path)),
    JSON.stringify(list.map((d) => d.path)));
  ok("repo/exports trỏ đúng vào agile-studio",
    dests.DEST_REPO.replace(/\\/g, "/").endsWith("agile-studio/exports"), dests.DEST_REPO);

  // Cảnh báo gitignore: đây là thứ tránh commit nhầm .docx hàng MB vào repo.
  const g1 = await dests.gitIgnoreStatus(dests.DEST_REPO);
  ok("repo/exports: nhận ra nằm trong repo git", g1.inRepo === true, JSON.stringify(g1));
  ok("repo/exports: ĐÃ được gitignore", g1.ignored === true, JSON.stringify(g1));

  // Một thư mục trong repo mà chắc chắn KHÔNG được ignore → phải cảnh báo.
  const g2 = await dests.gitIgnoreStatus(dests.DEST_REPO.replace(/exports$/, "server"));
  ok("thư mục không ignore: inRepo nhưng ignored=false", g2.inRepo && !g2.ignored, JSON.stringify(g2));

  // Ngoài repo git → không cảnh báo gì.
  const g3 = await dests.gitIgnoreStatus(dests.DEST_DATA);
  ok("dataDir ngoài repo git → không cảnh báo", g3.inRepo === false, JSON.stringify(g3));

  ok("đường dẫn rỗng không vỡ", (await dests.gitIgnoreStatus("")).inRepo === false);
  // Path tuyệt đối, không tồn tại, NGOÀI repo trên mọi HĐH (dựa trên DEST_DATA ở home). Không dùng
  // "Z:/…" vì trên POSIX nó là đường dẫn TƯƠNG ĐỐI → rơi vào trong repo và `checked` thành true.
  ok("đường dẫn không tồn tại không vỡ",
    (await dests.gitIgnoreStatus(dests.DEST_DATA + "/khong-he-ton-tai-" + Date.now())).checked === false);

  ok("dirInfo báo đúng tồn tại", dests.dirInfo(dests.DEST_REPO.replace(/exports$/, "server")).isDir === true);
  ok("dirInfo báo đúng không tồn tại", dests.dirInfo("Z:/khong-ton-tai").exists === false);

  // `revealDir` phải nói ra nó mở ở ĐÂU: cửa sổ mở trên máy chạy server, không phải máy đang xem
  // trình duyệt. Giao diện dựa vào `host` để nói đúng thay vì im lặng (xem chú thích trong dests.js).
  // KHÔNG gọi revealDir thật ở đây — nó bật một cửa sổ Explorer lên màn hình người đang chạy test.
  const src = await (await import("node:fs")).promises.readFile(
    new URL("../server/docgen/dests.js", import.meta.url), "utf8");
  ok("revealDir trả về host của máy chạy server", /host: hostname\(\)/.test(src));
  ok("revealDir trả object chứ không phải true trần", /return out;/.test(src) && !/return true;/.test(src));
  ok("thư mục không tồn tại thì revealDir ném lỗi, không im lặng",
    /throw new Error\("Thư mục không tồn tại/.test(src));

  // Không dùng DEST_DATA nữa: nó không còn là nơi lưu gợi ý, tạo ra chỉ để lại một thư mục rỗng
  // vĩnh viễn trong <dataDir>. Dựng rồi dọn một thư mục thăm dò thay vào đó.
  const probe = dests.DEST_DATA + "-probe-" + Date.now();
  const made = dests.ensureDir(probe);
  ok("ensureDir tạo được thư mục", existsSync(made));
  (await import("node:fs")).rmSync(probe, { recursive: true, force: true });
}

// ---- demo.js --------------------------------------------------------------------------------
console.log("\n[demo.js]");
{
  const demo = await import(APP + "docgen/demo.js");
  const { existsSync, readdirSync } = await import("node:fs");

  const f = demo.ensureDemoFiles();
  ok("dựng được repo mẫu", existsSync(demo.DEMO_DIR), demo.DEMO_DIR + " " + JSON.stringify(f));
  ok("có đủ tệp nguồn", ["README.md", "package.json", "src"].every((n) => existsSync(demo.DEMO_DIR + "/" + n)),
    JSON.stringify(readdirSync(demo.DEMO_DIR)));
  ok("KHÔNG có .git (đã chốt bỏ ca 5 ở demo)", !existsSync(demo.DEMO_DIR + "/.git"));
  ok("gọi lần hai không copy lại", demo.ensureDemoFiles().created === false);

  ok("nhận project mẫu theo tên", demo.isDemoProject({ name: "stale-demo", repo_path: "x" }));
  ok("nhận project mẫu theo đường dẫn", demo.isDemoProject({ name: "khac", repo_path: demo.DEMO_DIR }));
  ok("đường dẫn khác hoa/thường vẫn nhận",
    demo.isDemoProject({ name: "k", repo_path: demo.DEMO_DIR.toUpperCase() }));
  ok("không nhận project thật", !demo.isDemoProject({ name: "test-monorepo-turborepo", repo_path: "E:/gits/x" }));

  // Không còn cổng chặn nào: mọi project đều chạy được, chi phí do chế độ tiết kiệm giữ.
  ok("KHÔNG còn docgenGate", demo.docgenGate === undefined);
  ok("KHÔNG còn gateInfo", demo.gateInfo === undefined);
  ok("KHÔNG còn allowAllProjects", demo.allowAllProjects === undefined);

  // Đánh dấu + sắp thứ tự cho sidebar.
  const sorted = demo.markAndSortProjects([
    { id: 4, name: "stale-demo", repo_path: demo.DEMO_DIR },
    { id: 1, name: "repo-that", repo_path: "E:/gits/that" },
    { id: 2, name: "repo-khac", repo_path: "E:/gits/khac" },
  ]);
  ok("project mẫu bị đẩy xuống CUỐI", sorted.at(-1).name === "stale-demo",
    JSON.stringify(sorted.map((p) => p.name)));
  ok("project thật giữ nguyên thứ tự", sorted[0].name === "repo-that" && sorted[1].name === "repo-khac");
  ok("project mẫu có cờ demo", sorted.at(-1).demo === true);
  ok("project mẫu có nhãn", !!sorted.at(-1).demoBadge);
  ok("project mẫu có chú thích nhận dạng", /kiểm thử/.test(sorted.at(-1).demoHint || ""),
    sorted.at(-1).demoHint);
  ok("chú thích nói rõ Studio tự dựng lại được", /dựng lại/.test(sorted.at(-1).demoHint));
  ok("project thật KHÔNG bị gắn cờ", sorted[0].demo === undefined);
  ok("danh sách rỗng không vỡ", demo.markAndSortProjects([]).length === 0
    && demo.markAndSortProjects(null).length === 0);
}

// ---- store.js: chặn tạo project trùng --------------------------------------------------------
console.log("\n[store.js — chặn trùng tên/đường dẫn]");
{
  const { store } = await import(APP + "store.js");
  const demo = await import(APP + "docgen/demo.js");

  // Chỉ kiểm nhánh NÉM LỖI — nhánh thành công sẽ ghi studio.json, mà server của chủ repo đang chạy.
  let threw = null;
  try { store.addProject("stale-demo", "E:/khong-ton-tai-" + Date.now()); } catch (e) { threw = e.message; }
  ok("chặn trùng tên stale-demo", !!threw && threw.includes("dành cho project mẫu"), String(threw));

  // Nhánh này THÀNH CÔNG nên nó ghi thật vào studio.json — phải tự dọn, nếu không mỗi lần chạy test
  // lại để lại một project rác (đã mắc hai lần).
  threw = null;
  const nearMiss = demo.DEMO_DIR + "-nhung-khong-phai";
  try { store.addProject("ten-khac-tam", nearMiss); } catch (e) { threw = e.message; }
  ok("thư mục gần giống thì KHÔNG chặn oan", threw === null || !threw.includes("bản chạy"), String(threw));
  {
    const { readFileSync, writeFileSync } = await import("node:fs");
    const f = (await import("node:path")).join((await import("node:os")).homedir(), ".agile-studio", "studio.json");
    const j = JSON.parse(readFileSync(f, "utf8"));
    const before = j.projects.length;
    j.projects = j.projects.filter((p) => p.repo_path !== nearMiss);
    if (j.projects.length !== before) writeFileSync(f, JSON.stringify(j, null, 2));
    ok("test tự dọn project vừa tạo", j.projects.every((p) => p.repo_path !== nearMiss));
  }

  threw = null;
  try { store.addProject("ten-khac", demo.DEMO_DIR); } catch (e) { threw = e.message; }
  ok("chặn trùng đường dẫn demo (hoặc repo đã tồn tại)",
    !!threw && (threw.includes("bản chạy") || threw.includes("đã tồn tại")), String(threw));

  ok("có setProjectPath", typeof store.setProjectPath === "function");
}

// ---- write.js: prompt rút gọn ----------------------------------------------------------------
console.log("\n[write.js — prompt rút gọn]");
{
  const { buildWritePrompt } = await import(APP + "docgen/write.js");
  const { economyOf, ECONOMY_DEFAULTS } = await import(APP + "docgen/economy.js");
  const job = { id: "zz1", style: { tone: "concise" }, facts: { items: [], stack: null }, meta: {} };
  const std = { standard: "arc42", label: "arc42" };
  const doc = { key: "sad", title: "Software Architecture Document" };
  const targets = [{ docKey: "sad", doc, section: { num: "1", title: "Introduction", kind: "explanation",
    hint: "h", accept: { minBlocks: 2 }, sources: ["README.md"] } }];

  const full = buildWritePrompt({ job, std, doc, targets, eco: null });
  const short = buildWritePrompt({ job, std, doc, targets, eco: economyOf({ economy: { ...ECONOMY_DEFAULTS, on: true } }) });

  ok("prompt rút gọn ngắn hơn hẳn", short.length < full.length * 0.6,
    `full=${full.length} short=${short.length} (${Math.round(short.length / full.length * 100)}%)`);
  // Hai thứ KHÔNG được bỏ, dù rút gọn: nơi ghi tệp, và luật về nguồn (ca 2 kiểm nó).
  ok("rút gọn vẫn có đường dẫn ghi tệp", short.includes("GHI RA TỆP"));
  ok("rút gọn vẫn có luật về nguồn", short.includes("sources") && short.includes("assumption"));
  ok("rút gọn vẫn yêu cầu WRITE_DONE", short.includes("WRITE_DONE"));
  ok("rút gọn nói rõ là lượt tiết kiệm", short.includes("TIẾT KIỆM"));
  ok("prompt đầy đủ có lược đồ 9 khối", full.includes('"flow"') && full.includes('"callout"'));
  ok("rút gọn KHÔNG có lược đồ dài", !short.includes('"callout"'));
}

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} đạt · ${fail} lỗi`);
process.exit(fail === 0 ? 0 : 1);
