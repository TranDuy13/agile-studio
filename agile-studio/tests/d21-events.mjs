// Kiểm việc diễn giải stream-json của Claude Code bằng event ghi lại — 0 token.
// Đây là chỗ quyết định Console có nội dung hay không: sai ở đây thì log rỗng đúng như ca 11.
import { describeEvent as d } from "../server/runner.js";

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${x}`)); };

// ---- tool_use: tham số phải còn nguyên trong detail ------------------------------------------
console.log("\n[tool_use]");
{
  const ev = { type: "assistant", message: { content: [
    { type: "tool_use", id: "tu_1", name: "Bash",
      input: { command: "git log --oneline -20 | head -5 && echo xong", description: "xem commit" } },
  ] } };
  const off = d(ev, false), on = d(ev, true);
  ok("không verbose: chỉ một dòng ngắn, KHÔNG có detail", off.detail === undefined && off.kind === "tool");
  ok("verbose: có detail", !!on.detail);
  ok("verbose: giữ NGUYÊN lệnh Bash", on.detail.includes("git log --oneline -20 | head -5"), on.detail);
  ok("verbose: giữ cả tham số phụ", on.detail.includes("xem commit"));
  ok("verbose: có tên tool", on.tool === "Bash");
  ok("verbose: có toolId để ghép với tool_result", on.toolId === "tu_1");
}
{
  // Lệnh Bash dài hơn 120 ký tự: `text` cắt (thanh trạng thái), `detail` không cắt.
  const long = "echo " + "x".repeat(400);
  const ev = { type: "assistant", message: { content: [
    { type: "tool_use", name: "Bash", input: { command: long } }] } };
  const on = d(ev, true);
  ok("text cắt cho thanh trạng thái", on.text.length < 200, String(on.text.length));
  ok("detail KHÔNG cắt lệnh dài", on.detail.includes("x".repeat(400)), String(on.detail.length));
}
{
  const ev = { type: "assistant", message: { content: [
    { type: "tool_use", name: "Write", input: { file_path: "C:/tmp/ir/sad/6.2.json", content: "y".repeat(9000) } }] } };
  const on = d(ev, true);
  ok("Write: text có đường dẫn (khớp mục đang viết)", on.text.includes("6.2.json"), on.text);
  ok("Write: nội dung dài bị cắt sớm, không phình log",
    on.detail.length < 4000, String(on.detail.length));
  ok("Write: nói rõ đã cắt bớt", /cắt bớt/.test(on.detail));
}
{
  const ev = { type: "assistant", message: { content: [
    { type: "tool_use", name: "TodoWrite", input: { todos: [{ content: "Đọc README", status: "pending" }] } }] } };
  const on = d(ev, true);
  // Chính event này là dòng cuối của ca 11 — trước đây chỉ còn "🔧 TodoWrite".
  ok("TodoWrite: text như cũ", on.text === "🔧 TodoWrite", on.text);
  ok("TodoWrite: detail có nội dung todo", on.detail.includes("Đọc README"), on.detail);
}

// ---- text: toàn văn ---------------------------------------------------------------------------
console.log("\n[text Claude nói]");
{
  const long = "Tôi sẽ đọc các tệp nguồn. ".repeat(80);
  const ev = { type: "assistant", message: { content: [{ type: "text", text: long }] } };
  const off = d(ev, false), on = d(ev, true);
  ok("không verbose: cắt 400 như cũ", off.text.length <= 400, String(off.text.length));
  ok("verbose: detail dài hơn 400", on.detail.length > 400, String(on.detail.length));
  ok("verbose: giữ được đoạn cuối", on.detail.trim().endsWith("nguồn."), on.detail.slice(-40));
}

// ---- tool_result: chỉ verbose mới nhận -------------------------------------------------------
console.log("\n[tool_result — vì sao Claude bị vướng]");
{
  const ev = { type: "user", message: { content: [
    { type: "tool_result", tool_use_id: "tu_1", is_error: true,
      content: "EACCES: permission denied, open 'C:/tmp/ir/sad/1.json'" }] } };
  ok("không verbose: BỎ QUA (không làm nhiễu màn cũ)", d(ev, false) === null);
  const on = d(ev, true);
  ok("verbose: nhận thành tool_error", on.kind === "tool_error", on.kind);
  ok("verbose: text nêu lý do", on.text.includes("EACCES"), on.text);
  ok("verbose: detail đủ đường dẫn", on.detail.includes("sad/1.json"));
  ok("verbose: ghép được với tool_use", on.toolId === "tu_1");
}
{
  const ev = { type: "user", message: { content: [
    { type: "tool_result", tool_use_id: "tu_2",
      content: [{ type: "text", text: "     1→import x\n     2→const y = 1" }] }] } };
  const on = d(ev, true);
  ok("tool_result dạng mảng khối cũng đọc được", on.kind === "tool_result", JSON.stringify(on));
  ok("giữ nội dung tệp đã đọc", on.detail.includes("const y = 1"));
}

// ---- result / system --------------------------------------------------------------------------
console.log("\n[result & system]");
{
  const ev = { type: "result", subtype: "success", duration_ms: 41230, is_error: false,
    total_cost_usd: 0.0123,
    usage: { input_tokens: 12, output_tokens: 340, cache_creation_input_tokens: 8000, cache_read_input_tokens: 21000 } };
  const on = d(ev, true);
  ok("result: usage còn nguyên để tính token", on.usage.cache_read_input_tokens === 21000);
  ok("result: detail có chi phí", on.detail.includes("0.0123"), on.detail);
  ok("result: detail có thời gian", on.detail.includes("41230"));
}
{
  const ev = { type: "result", subtype: "error_max_turns", usage: {} };
  ok("result lỗi: text nêu subtype", d(ev, true).text.includes("error_max_turns"));
}
{
  const ev = { type: "system", subtype: "init", session_id: "abc-123", model: "claude-haiku-4-5-20251001",
    cwd: "C:/demo", permissionMode: "bypassPermissions", tools: ["Read", "Write"] };
  ok("không verbose: bỏ qua system", d(ev, false) === null);
  const on = d(ev, true);
  ok("verbose: system cho biết model THẬT đã dùng",
    on.detail.includes("claude-haiku-4-5-20251001"), on.detail);
  ok("verbose: system cho biết cwd", on.detail.includes("C:/demo"));
}

// ---- event lạ không được làm vỡ ---------------------------------------------------------------
console.log("\n[chống vỡ]");
{
  ok("event rỗng", d({}, true) === null);
  ok("assistant không có content", d({ type: "assistant", message: {} }, true) === null);
  ok("assistant content rỗng", d({ type: "assistant", message: { content: [] } }, true) === null);
  ok("text rỗng thì bỏ qua", d({ type: "assistant", message: { content: [{ type: "text", text: "   " }] } }, true) === null);
  ok("tool_use không có input", !!d({ type: "assistant", message: { content: [{ type: "tool_use", name: "X" }] } }, true));
  ok("kiểu lạ", d({ type: "hoan_toan_moi", x: 1 }, true) === null);
  ok("tool_result content rỗng vẫn có text",
    !!d({ type: "user", message: { content: [{ type: "tool_result", content: "" }] } }, true)?.text);
}

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} đạt · ${fail} lỗi`);
process.exit(fail === 0 ? 0 : 1);
