// Discord bot điều khiển Agile Studio từ xa + nhận thông báo.
// Chạy CÙNG MÁY với server (gọi localhost:4311). Bot kết nối RA Discord nên không cần mở cổng.
//
// Config: `.env` is the primary source — DISCORD_TOKEN / DISCORD_CHANNEL / DISCORD_MENTION /
//   DISCORD_PREFIX / AGILE_API. A bot.config.json (gitignored) / ~/.agile-studio/bot.json still
//   works as an optional local fallback. Enable the "MESSAGE CONTENT" intent in the Discord portal.
import "dotenv/config"; // load .env (the bot is its own `npm run bot` process, not routed through server/config.js)
import { WebSocket } from "ws";
import { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const cfgPath = [join(APP_ROOT, "bot.config.json"), join(homedir(), ".agile-studio", "bot.json")].find((p) => existsSync(p));
const cfg = cfgPath ? JSON.parse(readFileSync(cfgPath, "utf8")) : {};
if (cfgPath) console.log("Đọc config:", cfgPath);
const TOKEN = process.env.DISCORD_TOKEN || cfg.discordToken;
const CHANNEL = process.env.DISCORD_CHANNEL || cfg.channelId || "";
const API = (process.env.AGILE_API || cfg.api || "http://localhost:4311").replace(/\/$/, "");
const PREFIX = process.env.DISCORD_PREFIX || cfg.prefix || "!";
const MENTION = process.env.DISCORD_MENTION || cfg.mentionUserId || "";
const ping = MENTION ? `<@${MENTION}> ` : "";
if (!TOKEN) {
  console.error("⚠ Chưa có DISCORD_TOKEN trong .env (hay bot.config.json) — bot idle (không giật sập npm run dev).");
  setInterval(() => {}, 1 << 30);
}

const api = (path, opts) => fetch(API + path, opts).then((r) => r.json());
const sess = new Map(); // id -> { feature }

// ---- mode / node ----
const ROLE_ORDER = ["pm", "ba", "da", "dev", "qc", "po"];
const ROLE_EMO = { pm: "🎯", ba: "📋", da: "🏗️", dev: "💻", qc: "🔍", po: "✅" };
const NODE_EMO = { pending: "⚪", running: "🟡", done: "🟢", error: "🔴", disabled: "⚫" };
const PRESETS = {
  full: ROLE_ORDER, refine: ["pm", "ba", "da"], analyze: ["ba", "da"],
  build: ["dev"], devtest: ["dev", "qc"], harden: ["qc", "po"], impl: ["dev", "qc", "po"],
};
function parseRoles(token) {
  if (!token) return null;
  if (PRESETS[token]) return PRESETS[token];
  const rs = token.replace(/^\[|\]$/g, "").split(",").map((r) => r.trim().toLowerCase()).filter((r) => ROLE_ORDER.includes(r));
  return rs.length ? ROLE_ORDER.filter((r) => rs.includes(r)) : null;
}
const STATUS_COLOR = { running: 0xffb020, done: 0x35d07f, error: 0xff5b5b, stopped: 0x9aa4b2 };

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

async function channel() { try { return await client.channels.fetch(CHANNEL); } catch { return null; } }
async function post(content, extra = {}) { if (!CHANNEL) return; const ch = await channel(); try { await ch?.send({ content: String(content).slice(0, 1900), ...extra }); } catch {} }

// ---- format ----
function detailEmbed(s) {
  const flow = ROLE_ORDER.map((rid) => {
    const n = (s.nodes || []).find((x) => x.id === rid) || {};
    const inMode = s.roles.includes(rid);
    return `${inMode ? (NODE_EMO[n.status] || "⚪") : "⚫"}${ROLE_EMO[rid]}`;
  }).join(" ");
  const running = (s.nodes || []).find((n) => n.status === "running");
  const pend = (s.queue || []).filter((q) => !q.applied);
  const e = new EmbedBuilder()
    .setTitle(`${s.feature || "(không mô tả)"}`)
    .setColor(STATUS_COLOR[s.status] ?? 0x7c9cff)
    .setDescription(flow)
    .addFields(
      { name: "Trạng thái", value: `${s.status}${running ? ` · đang: ${running.name}` : ""}`, inline: true },
      { name: "Mode", value: s.roles.join("→") || "-", inline: true },
      { name: "Model", value: s.model || "mặc định", inline: true },
    )
    .setFooter({ text: `id ${s.id}${s.activeAccount ? ` · ${s.activeAccount}` : ""}${s.cost ? ` · 💰$${s.cost.toFixed(2)}` : ""}${s.startedAt ? ` · ⏱${Math.max(1, Math.round((Date.now() - s.startedAt) / 60000))}m` : ""}${s.streamLog ? " · 📡log" : ""}${pend.length ? ` · ⏳${pend.length}` : ""}` });
  if (running?.activity) e.addFields({ name: "Đang làm", value: running.activity.slice(0, 200) });
  return e;
}
function controlRow(s) {
  const row = new ActionRowBuilder();
  if (s.status === "running") row.addComponents(new ButtonBuilder().setCustomId(`act:pause:${s.id}`).setLabel("Tạm dừng").setEmoji("⏸️").setStyle(ButtonStyle.Danger));
  if (s.status === "stopped" || s.status === "error") row.addComponents(new ButtonBuilder().setCustomId(`act:resume:${s.id}`).setLabel("Tiếp tục").setEmoji("▶️").setStyle(ButtonStyle.Success));
  row.addComponents(new ButtonBuilder().setCustomId(`qbtn:${s.id}`).setLabel("Bổ sung").setEmoji("➕").setStyle(ButtonStyle.Primary));
  row.addComponents(new ButtonBuilder().setCustomId(`stream:${s.id}`).setLabel(s.streamLog ? "Log: BẬT" : "Log").setEmoji("📡").setStyle(s.streamLog ? ButtonStyle.Success : ButtonStyle.Secondary));
  row.addComponents(new ButtonBuilder().setCustomId(`act:detail:${s.id}`).setLabel("Làm mới").setEmoji("🔄").setStyle(ButtonStyle.Secondary));
  if (s.status !== "running") row.addComponents(new ButtonBuilder().setCustomId(`act:del:${s.id}`).setLabel("Xoá").setEmoji("🗑️").setStyle(ButtonStyle.Secondary));
  return row.components.length ? [row] : [];
}
const findSession = async (sid) => (await api("/api/sessions")).find((s) => s.id === sid || s.id.endsWith(sid));

// Nút "▶ Feature" cho từng project (tối đa 25).
function projectRows(ps) {
  const rows = [];
  for (let i = 0; i < ps.length && rows.length < 5; i += 5) {
    const row = new ActionRowBuilder();
    ps.slice(i, i + 5).forEach((p) => row.addComponents(
      new ButtonBuilder().setCustomId(`newrun:${p.id}`).setLabel(p.name.slice(0, 70)).setEmoji("▶️").setStyle(ButtonStyle.Primary)));
    rows.push(row);
  }
  return rows;
}
// Modal tạo feature (title + description + mode/node).
function newRunModal(pid) {
  return new ModalBuilder().setCustomId(`newrun:${pid}`).setTitle("Tạo feature mới").addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("title").setLabel("Tên feature").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("vd: DEV_06 Xuất Excel HEMIS")),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("desc").setLabel("Mô tả / yêu cầu (đưa vào prompt)").setStyle(TextInputStyle.Paragraph).setRequired(false)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("mode").setLabel("Mode/node").setStyle(TextInputStyle.Short).setRequired(false).setValue("full").setPlaceholder("full · build · refine · dev,qc …")),
  );
}
// Modal nhập queue message.
function queueModal(sid) {
  return new ModalBuilder().setCustomId(`queuemodal:${sid}`).setTitle("Yêu cầu bổ sung").addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("message").setLabel("Nội dung yêu cầu").setStyle(TextInputStyle.Paragraph).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("nodes").setLabel("Node (vd: dev,qc) — trống = agent gần nhất").setStyle(TextInputStyle.Short).setRequired(false)),
  );
}

// Menu chọn session (tối đa 25) -> mở detail.
function sessionsSelect(ss) {
  if (!ss.length) return [];
  const menu = new StringSelectMenuBuilder().setCustomId("pick:session").setPlaceholder("Chọn session để xem/điều khiển…")
    .addOptions(ss.slice(-25).reverse().map((s) => ({
      label: (s.feature || s.id).slice(0, 90),
      description: `[${s.status}] ${s.roles.join("→")}`.slice(0, 90),
      value: s.id,
    })));
  return [new ActionRowBuilder().addComponents(menu)];
}

// ---- Slash commands ----
const S = { STR: 3, INT: 4 };
const modeChoices = Object.keys(PRESETS).map((k) => ({ name: `${k} (${PRESETS[k].join("→")})`, value: k }));
const SLASH = [
  { name: "run", description: "Chạy feature mới", options: [
    { name: "project", description: "Project", type: S.STR, required: true, autocomplete: true },
    { name: "feature", description: "Mô tả feature", type: S.STR, required: true },
    { name: "mode", description: "Mode (preset)", type: S.STR, choices: modeChoices },
    { name: "nodes", description: "Node cụ thể, vd: dev,qc", type: S.STR },
    { name: "model", description: "Model Claude", type: S.STR, autocomplete: true },
  ] },
  { name: "sessions", description: "Danh sách session", options: [{ name: "project", description: "Lọc theo project", type: S.STR, autocomplete: true }] },
  { name: "detail", description: "Chi tiết + điều khiển session", options: [{ name: "session", description: "Session", type: S.STR, required: true, autocomplete: true }] },
  { name: "queue", description: "Thêm yêu cầu bổ sung", options: [
    { name: "session", description: "Session", type: S.STR, required: true, autocomplete: true },
    { name: "message", description: "Nội dung", type: S.STR, required: true },
    { name: "nodes", description: "Node (re)chạy, vd: dev,qc", type: S.STR },
  ] },
  { name: "resume", description: "Chạy tiếp session", options: [
    { name: "session", description: "Session", type: S.STR, required: true, autocomplete: true },
    { name: "nodes", description: "Chỉ chạy node này (bỏ trống = mọi node)", type: S.STR },
  ] },
  { name: "pause", description: "Tạm dừng session", options: [{ name: "session", description: "Session", type: S.STR, required: true, autocomplete: true }] },
  { name: "delete", description: "Xoá session", options: [{ name: "session", description: "Session", type: S.STR, required: true, autocomplete: true }] },
  { name: "accounts", description: "Account Claude (xem/đổi)" },
  { name: "stopall", description: "Tạm dừng tất cả session đang chạy" },
  { name: "schedule", description: "Lên lịch chạy feature", options: [
    { name: "project", description: "Project", type: S.STR, required: true, autocomplete: true },
    { name: "feature", description: "Mô tả feature", type: S.STR, required: true },
    { name: "kind", description: "Kiểu lịch", type: S.STR, required: true, choices: [
      { name: "Một lần (time = YYYY-MM-DD HH:MM)", value: "once" },
      { name: "Hàng ngày (time = HH:MM)", value: "daily" },
      { name: "Định kỳ (time = số phút)", value: "interval" }] },
    { name: "time", description: "Thời gian (theo kind)", type: S.STR, required: true },
    { name: "description", description: "Mô tả chi tiết (đưa vào prompt)", type: S.STR },
    { name: "mode", description: "Mode", type: S.STR, choices: modeChoices },
  ] },
  { name: "schedules", description: "Danh sách lịch đã đặt" },
];

// ---- Stream log vào THREAD riêng của session (không lộn session/tin nhắn khác) ----
const streamBuf = new Map(); // sid -> [lines]
async function ensureThread(sid, feature) {
  const info = sess.get(sid) || {};
  if (info.threadId) return info.threadId;
  const ch = await channel();
  if (!ch?.threads) return null;
  try {
    const th = await ch.threads.create({ name: `📡 ${(feature || sid).slice(0, 55)} · ${sid.slice(-5)}`, autoArchiveDuration: 1440 });
    info.threadId = th.id; sess.set(sid, info);
    api(`/api/sessions/${sid}`, { method: "PATCH", headers: J, body: JSON.stringify({ threadId: th.id }) }).catch(() => {});
    await th.send(`📡 Stream log: **${feature || sid}** \`${sid}\``);
    return th.id;
  } catch { return null; }
}
setInterval(async () => { // gộp log mỗi ~2.5s -> gửi vào thread (đỡ spam, dễ đọc)
  for (const [sid, lines] of streamBuf) {
    if (!lines.length) continue;
    streamBuf.set(sid, []);
    const tid = sess.get(sid)?.threadId; if (!tid) continue;
    try {
      const th = await client.channels.fetch(tid);
      let chunk = "";
      for (const l of lines) { if ((chunk + l).length > 1800) { await th.send(chunk); chunk = ""; } chunk += l + "\n"; }
      if (chunk.trim()) await th.send(chunk);
    } catch {}
  }
}, 2500);

// ---- Báo trạng thái về server để UI hiện được "bot có kết nối không" (issue 17) ----
// Bot là tiến trình riêng nên server không tự biết; ở đây tự khai báo + heartbeat.
const STARTED_AT = Date.now();
let wsConnected = false;
let lastError = TOKEN ? null : "Chưa cấu hình DISCORD_TOKEN (.env)";

async function checkChannel() {
  if (!CHANNEL) return false;
  return !!(await channel());
}
async function report(extra = {}) {
  const ready = !!client?.user;
  const body = {
    ok: ready && !lastError, configured: !!TOKEN, error: lastError,
    user: client?.user?.tag || null, guilds: client?.guilds?.cache?.size || 0,
    channelId: CHANNEL, channelOk: ready ? await checkChannel() : null,
    prefix: PREFIX, wsConnected, pid: process.pid, startedAt: STARTED_AT, ...extra,
  };
  try { await fetch(API + "/api/bot/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
  catch { /* server chưa lên / đang restart — heartbeat sau sẽ bù */ }
}
setInterval(() => report(), 15000);

// Người dùng bấm "Thử lại" trên UI -> server phát bot:retry -> đăng nhập lại (hoặc kiểm tra lại).
async function retryLogin() {
  if (!TOKEN) { lastError = "Chưa cấu hình DISCORD_TOKEN (.env)"; return report(); }
  if (client.user) { lastError = null; return report(); } // đã online: chỉ kiểm tra lại channel
  try { await client.login(TOKEN); lastError = null; }
  catch (e) { lastError = "Đăng nhập Discord lỗi: " + e.message; }
  report();
}

// ---- WebSocket notifications ----
function connectWS() {
  const ws = new WebSocket(API.replace(/^http/, "ws"));
  ws.on("open", () => { wsConnected = true; report(); });
  ws.on("message", async (buf) => {
    let e; try { e = JSON.parse(buf.toString()); } catch { return; }
    if (e.type === "bot:retry") { retryLogin(); return; }
    if (e.type === "session:init" && e.data) {
      const prev = sess.get(e.data.id) || {};
      const info = { feature: e.data.feature, streamLog: e.data.streamLog, threadId: e.data.threadId || prev.threadId };
      sess.set(e.data.id, info);
      if (info.streamLog && !info.threadId) ensureThread(e.data.id, e.data.feature);
    }
    if (e.type === "log" && e.session && sess.get(e.session)?.streamLog) {
      const l = `${e.emoji || ""} **${e.roleName || e.role || ""}**: ${e.text || ""}`.slice(0, 400);
      const a = streamBuf.get(e.session) || []; a.push(l); streamBuf.set(e.session, a);
    }
    const feat = sess.get(e.session)?.feature || e.session || "";
    if (e.type === "flow:done") { const s = await findSession(e.session);
      post(`${ping}✅ **XONG**: ${feat}`, s ? { components: controlRow(s) } : {}); }
    else if (e.type === "flow:error" || e.type === "node:error") { const s = await findSession(e.session);
      post(`${ping}✖ **LỖI**: ${feat}${e.message ? " — " + e.message.slice(0, 200) : ""}`, s ? { components: controlRow(s) } : {}); }
    else if (e.type === "account:exhausted") post(`${ping}⚠ Hết quota các account (session \`${e.session || "-"}\`)`);
  });
  ws.on("close", () => { wsConnected = false; setTimeout(connectWS, 3000); });
  ws.on("error", () => {});
}

function helpEmbed() {
  const p = PREFIX;
  return new EmbedBuilder()
    .setTitle("🤖 Agile Studio — Lệnh điều khiển")
    .setColor(0x7c9cff)
    .addFields(
      { name: "👀 Xem", value: `\`${p}projects\` · \`${p}sessions [pid]\` · \`${p}detail <sid>\` · \`${p}accounts\` · \`${p}models\`` },
      { name: "▶️ Chạy feature", value: `\`${p}run <pid> [mode|nodes] <feature>\`\nvd: \`${p}run 1 build Xuất Excel\` · \`${p}run 1 [dev,qc] Thêm API\`` },
      { name: "🎛️ Mode (mode)", value: Object.entries(PRESETS).map(([k, v]) => `\`${k}\` = ${v.map((r) => ROLE_EMO[r]).join("")}`).join("\n") },
      { name: "🔵 Node (nodes)", value: ROLE_ORDER.map((r) => `${ROLE_EMO[r]}\`${r}\``).join(" · ") + `\n→ nhiều node: \`[dev,qc]\`` },
      { name: "🕹️ Điều khiển", value: `\`${p}queue <sid> [nodes] <msg>\` · \`${p}resume <sid> [nodes]\`\n\`${p}pause <sid>\` · \`${p}rm <sid>\` · \`${p}stopall\`` },
      { name: "👤 Account Claude", value: `\`${p}acc\` (xem) · \`${p}acc on|off <id>\` · \`${p}acc default <id>\` · \`${p}acc clear\`` },
      { name: "⏰ Lịch", value: `\`/schedule\` (đặt lịch) · \`/schedules\` (xem). Kiểu: once/daily/interval.` },
      { name: "💡 Mẹo", value: "Bấm **nút** dưới mỗi thông báo / `detail` để Tạm dừng / Tiếp tục / Xoá nhanh." },
    )
    .setFooter({ text: `prefix "${p}" · ${p}myid để lấy User ID cho @ping` });
}

let readyDone = false;
const onReady = async () => { if (readyDone) return; readyDone = true;
  console.log("Bot online:", client.user.tag);
  lastError = null;
  try { for (const g of client.guilds.cache.values()) await g.commands.set(SLASH); console.log("Đã đăng ký slash commands ✓"); }
  catch (e) { console.error("Đăng ký slash lỗi:", e.message); }
  report();
  post("🤖 Agile Studio bot online. Gõ `" + PREFIX + "help` hoặc `/`."); };
client.once("clientReady", onReady);
client.once("ready", onReady);

// ---- interactions: buttons + select menu + slash + autocomplete ----
const J = { "Content-Type": "application/json" };
async function createRun(pid, feature, roles, model, note) {
  const body = { feature, ...(roles ? { roles } : {}), ...(model ? { model } : {}), ...(note ? { note } : {}) };
  const r = await api(`/api/projects/${pid}/run`, { method: "POST", headers: J, body: JSON.stringify(body) });
  if (r.session) sess.set(r.session.id, { feature });
  return r;
}

client.on("interactionCreate", async (i) => {
  try {
    // Autocomplete
    if (i.isAutocomplete()) {
      const foc = i.options.getFocused(true); const q = (foc.value || "").toLowerCase();
      let choices = [];
      if (foc.name === "project") choices = (await api("/api/projects")).map((p) => ({ name: `${p.name} (#${p.id})`, value: String(p.id) }));
      else if (foc.name === "session") choices = (await api("/api/sessions")).map((s) => ({ name: `${(s.feature || s.id).slice(0, 70)} [${s.status}]`, value: s.id }));
      else if (foc.name === "model") choices = [{ name: "Mặc định", value: "" }, ...(await api("/api/models")).models.map((m) => ({ name: m.name, value: m.id }))];
      return void i.respond(choices.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 25));
    }

    // Button mở modal: tạo feature / nhập queue
    if (i.isButton() && i.customId.startsWith("newrun:")) return void i.showModal(newRunModal(i.customId.split(":")[1]));
    if (i.isButton() && i.customId.startsWith("qbtn:")) return void i.showModal(queueModal(i.customId.split(":")[1]));

    // Button bật/tắt stream log
    if (i.isButton() && i.customId.startsWith("stream:")) {
      const sid = i.customId.split(":")[1];
      const s = await findSession(sid);
      await api(`/api/sessions/${sid}`, { method: "PATCH", headers: J, body: JSON.stringify({ streamLog: !s?.streamLog }) });
      await new Promise((r) => setTimeout(r, 250));
      const s2 = await findSession(sid);
      return void i.update(s2 ? { embeds: [detailEmbed(s2)], components: controlRow(s2) } : { content: "(không còn)", embeds: [], components: [] });
    }

    // Modal submit
    if (i.isModalSubmit()) {
      const v = (n) => i.fields.getTextInputValue(n);
      if (i.customId.startsWith("newrun:")) {
        const pid = i.customId.split(":")[1];
        const roles = parseRoles((v("mode") || "").trim().toLowerCase());
        const r = await createRun(pid, v("title").trim(), roles, null, (v("desc") || "").trim());
        return void i.reply(r.session ? { content: "▶ Đã tạo session", embeds: [detailEmbed(r.session)], components: controlRow(r.session) } : { content: `Lỗi: ${r.error || "?"}` });
      }
      if (i.customId.startsWith("queuemodal:")) {
        const sid = i.customId.split(":")[1];
        const roles = v("nodes") ? parseRoles(v("nodes")) : null;
        const r = await api(`/api/sessions/${sid}/queue`, { method: "POST", headers: J, body: JSON.stringify({ text: v("message").trim(), ...(roles ? { roles } : {}) }) });
        return void i.reply({ content: r.ok ? `➕ Đã gửi yêu cầu bổ sung${roles ? ` [${roles.join(",")}]` : ""} cho \`${sid}\`` : `Lỗi: ${r.error || "?"}`, ephemeral: true });
      }
    }

    // Button điều khiển session
    if (i.isButton() && i.customId.startsWith("act:")) {
      const [, act, sid] = i.customId.split(":");
      if (act === "pause") await api(`/api/sessions/${sid}/stop`, { method: "POST" });
      else if (act === "resume") await api(`/api/sessions/${sid}/resume`, { method: "POST" });
      else if (act === "del") { await api(`/api/sessions/${sid}`, { method: "DELETE" }); return void i.update({ content: `🗑 Đã xoá \`${sid}\``, embeds: [], components: [] }); }
      await new Promise((r) => setTimeout(r, act === "pause" ? 900 : 300));
      const s = await findSession(sid);
      return void i.update(s ? { embeds: [detailEmbed(s)], components: controlRow(s) } : { content: "(session không còn)", embeds: [], components: [] });
    }

    // Select menu (chọn session từ list)
    if (i.isStringSelectMenu() && i.customId === "pick:session") {
      const s = await findSession(i.values[0]);
      return void i.update(s ? { content: "", embeds: [detailEmbed(s)], components: [...controlRow(s)] } : { content: "(không còn)", embeds: [], components: [] });
    }

    // Slash commands
    if (i.isChatInputCommand()) {
      const o = (n) => i.options.getString(n);
      switch (i.commandName) {
        case "run": {
          const roles = o("nodes") ? parseRoles(o("nodes")) : (o("mode") ? PRESETS[o("mode")] : null);
          const r = await createRun(o("project"), o("feature"), roles, o("model"));
          return void i.reply(r.session ? { content: `▶ Tạo session`, embeds: [detailEmbed(r.session)], components: controlRow(r.session) } : { content: `Lỗi: ${r.error || "?"}` });
        }
        case "sessions": {
          let ss = await api("/api/sessions");
          if (o("project")) ss = ss.filter((s) => String(s.projectId) === o("project"));
          ss.forEach((s) => sess.set(s.id, { feature: s.feature }));
          const txt = ss.slice(-15).map((s) => `${NODE_EMO[s.status === "done" ? "done" : s.status === "error" ? "error" : s.status === "running" ? "running" : "pending"]} \`${s.id}\` [${s.status}] ${s.feature || ""}`).join("\n") || "(chưa có session)";
          return void i.reply({ content: txt, components: sessionsSelect(ss) });
        }
        case "detail": { const s = await findSession(o("session")); return void i.reply(s ? { embeds: [detailEmbed(s)], components: controlRow(s) } : { content: "Không thấy session" }); }
        case "queue": {
          const roles = o("nodes") ? parseRoles(o("nodes")) : null;
          const r = await api(`/api/sessions/${o("session")}/queue`, { method: "POST", headers: J, body: JSON.stringify({ text: o("message"), ...(roles ? { roles } : {}) }) });
          return void i.reply(r.ok ? `➕ Đã thêm vào queue${roles ? ` [${roles.join(",")}]` : ""}` : `Lỗi: ${r.error || "?"}`);
        }
        case "resume": {
          const roles = o("nodes") ? parseRoles(o("nodes")) : null;
          const r = roles ? await api(`/api/sessions/${o("session")}/queue`, { method: "POST", headers: J, body: JSON.stringify({ text: "", roles }) })
            : await api(`/api/sessions/${o("session")}/resume`, { method: "POST" });
          return void i.reply(r.ok ? `▶ Tiếp tục${roles ? ` [${roles.join(",")}]` : " (mọi node)"}` : `Lỗi: ${r.error || "?"}`);
        }
        case "pause": { const r = await api(`/api/sessions/${o("session")}/stop`, { method: "POST" }); return void i.reply(r.ok ? "⏸ Đã tạm dừng" : `Lỗi: ${r.error || "?"}`); }
        case "delete": { await api(`/api/sessions/${o("session")}`, { method: "DELETE" }); return void i.reply("🗑 Đã xoá"); }
        case "accounts": {
          const d = await api("/api/accounts?usage=1");
          return void i.reply(d.accounts.map((a) => `${a.disabled ? "⚫ tắt" : a.id === d.active ? "🟢 đang dùng" : "⚪"}${d.preferred === a.id ? " ⭐" : ""} \`${a.id}\` ${a.label}${a.usage?.fiveHourPct != null ? ` — ${Math.round(a.usage.fiveHourPct)}%` : ""}`).join("\n") || "(không có)");
        }
        case "stopall": {
          const run = (await api("/api/sessions")).filter((s) => s.status === "running");
          await Promise.all(run.map((s) => api(`/api/sessions/${s.id}/stop`, { method: "POST" })));
          return void i.reply(`⏸ Đã tạm dừng ${run.length} session.`);
        }
        case "schedule": {
          const kind = o("kind"), time = o("time");
          const body = { projectId: o("project"), feature: o("feature"), note: o("description") || "", kind, ...(o("mode") ? { roles: PRESETS[o("mode")] } : {}) };
          if (kind === "once") body.at = new Date(time.replace(" ", "T")).toISOString();
          else if (kind === "daily") body.at = time;
          else body.everyMin = Number(time) || 60;
          const r = await api("/api/schedules", { method: "POST", headers: J, body: JSON.stringify(body) });
          return void i.reply(r.schedule ? `⏰ Đã lên lịch **${o("feature")}** (${kind} · ${time})` : `Lỗi: ${r.error || "?"}`);
        }
        case "schedules": {
          const ss = await api("/api/schedules");
          return void i.reply(ss.map((s) => `${s.enabled ? "🟢" : "⚫"} \`${s.id.slice(-6)}\` ${s.feature} — ${s.kind === "once" ? new Date(s.at).toLocaleString() : s.kind === "daily" ? "hàng ngày " + s.at : "mỗi " + s.everyMin + "p"}`).join("\n") || "(chưa có lịch)");
        }
      }
    }
  } catch (e) { try { i.isRepliable() && !i.replied && await i.reply({ content: "Lỗi: " + e.message, ephemeral: true }); } catch {} }
});

// ---- text commands ----
client.on("messageCreate", async (msg) => {
  if (msg.author.bot || !msg.content.startsWith(PREFIX)) return;
  const [cmd, ...args] = msg.content.slice(PREFIX.length).trim().split(/\s+/);
  const reply = (c, extra) => msg.reply({ content: typeof c === "string" ? c : undefined, ...(extra || {}) });
  try {
    switch (cmd) {
      case "help": case "": return void reply(null, { embeds: [helpEmbed()] });
      case "myid": return void reply(`User ID: \`${msg.author.id}\` — dán vào \`mentionUserId\` để nhận @ping.`);
      case "modes": return void reply("Modes: " + Object.entries(PRESETS).map(([k, v]) => `\`${k}\`(${v.join("→")})`).join(" · "));

      case "projects": case "p": {
        const ps = await api("/api/projects");
        if (!ps.length) return void reply("(chưa có project)");
        return void reply(ps.map((p) => `\`${p.id}\` **${p.name}** — ${p.repo_path}`).join("\n") + "\n\n▼ Bấm nút để tạo feature mới:", { components: projectRows(ps) });
      }
      case "accounts": case "acc": {
        const sub = (args[0] || "").toLowerCase(), aid = args[1];
        const H = { "Content-Type": "application/json" };
        if ((sub === "on" || sub === "off") && aid) {
          const r = await api(`/api/accounts/${aid}`, { method: "PATCH", headers: H, body: JSON.stringify({ enabled: sub === "on" }) });
          return void reply(r.ok ? `${sub === "on" ? "✅ Bật" : "⛔ Tắt"} account \`${aid}\`` : `Lỗi: ${r.error || "?"}`);
        }
        if ((sub === "default" || sub === "star" || sub === "use") && aid) {
          const r = await api("/api/settings", { method: "PUT", headers: H, body: JSON.stringify({ preferredAccount: aid }) });
          return void reply(r ? `⭐ Đặt account mặc định: \`${aid}\`` : "Lỗi");
        }
        if (sub === "clear") { await api("/api/settings", { method: "PUT", headers: H, body: JSON.stringify({ preferredAccount: "" }) }); return void reply("⭐ Đã bỏ account mặc định (tự chọn theo quota)."); }
        const d = await api("/api/accounts?usage=1");
        const lines = d.accounts.map((a) => `${a.disabled ? "⚫ tắt" : a.id === d.active ? "🟢 đang dùng" : "⚪"}${d.preferred === a.id ? " ⭐" : ""} \`${a.id}\` ${a.label}${a.usage?.fiveHourPct != null ? ` — ${Math.round(a.usage.fiveHourPct)}% (5h)` : ""}`).join("\n");
        return void reply((lines || "(không có)") + `\n\`${PREFIX}acc on|off <id>\` · \`${PREFIX}acc default <id>\` · \`${PREFIX}acc clear\``);
      }
      case "models": {
        const d = await api("/api/models");
        return void reply("Models: " + (d.models || []).map((m) => `\`${m.id}\``).join(" · ") || "(không đọc được)");
      }
      case "sessions": case "ps": {
        let ss = await api("/api/sessions");
        if (args[0]) ss = ss.filter((s) => String(s.projectId) === args[0]);
        ss.forEach((s) => sess.set(s.id, { feature: s.feature }));
        if (!ss.length) return void reply("(chưa có session)");
        return void reply(ss.slice(-15).map((s) => `${NODE_EMO[s.status === "done" ? "done" : s.status === "error" ? "error" : s.status === "running" ? "running" : "pending"]} \`${s.id}\` [${s.status}] ${s.feature || ""}`).join("\n"), { components: sessionsSelect(ss) });
      }
      case "detail": case "d": {
        const s = await findSession(args[0] || "");
        if (!s) return void reply("Không thấy session. Xem `" + PREFIX + "sessions`.");
        return void reply(null, { embeds: [detailEmbed(s)], components: controlRow(s) });
      }
      case "run": {
        const pid = args.shift();
        let roles = null;
        if (args.length && (roles = parseRoles(args[0]))) args.shift();
        const feature = args.join(" ");
        if (!pid || !feature) return void reply(`Cú pháp: ${PREFIX}run <projectId> [mode|nodes] <feature>`);
        const body = { feature, ...(roles ? { roles } : {}) };
        const r = await api(`/api/projects/${pid}/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        if (!r.session) return void reply(`Lỗi: ${r.error || "?"}`);
        sess.set(r.session.id, { feature });
        return void reply(`▶ Tạo session cho "${feature}"`, { embeds: [detailEmbed(r.session)], components: controlRow(r.session) });
      }
      case "queue": case "q": {
        const sid = args.shift();
        let roles = null;
        if (args.length && (roles = parseRoles(args[0]))) args.shift();
        const text = args.join(" ");
        if (!sid || (!text && !roles)) return void reply(`Cú pháp: ${PREFIX}queue <sid> [nodes] <message>`);
        const r = await api(`/api/sessions/${sid}/queue`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, ...(roles ? { roles } : {}) }) });
        return void reply(r.ok ? `➕ Đã thêm vào queue \`${sid}\`${roles ? ` [${roles.join(",")}]` : ""}` : `Lỗi: ${r.error || "?"}`);
      }
      case "resume": {
        const sid = args.shift();
        const roles = args.length ? parseRoles(args.join(" ")) : null;
        if (!sid) return void reply(`Cú pháp: ${PREFIX}resume <sid> [nodes]`);
        // có chọn node -> chạy scoped qua queue; không -> resume full
        const r = roles
          ? await api(`/api/sessions/${sid}/queue`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "", roles }) })
          : await api(`/api/sessions/${sid}/resume`, { method: "POST" });
        return void reply(r.ok ? `▶ Tiếp tục \`${sid}\`${roles ? ` [${roles.join(",")}]` : " (mọi node)"}` : `Lỗi: ${r.error || "?"}`);
      }
      case "pause": case "stop": {
        const r = await api(`/api/sessions/${args[0]}/stop`, { method: "POST" });
        return void reply(r.ok ? `⏸ Đã tạm dừng \`${args[0]}\`` : `Lỗi: ${r.error || "?"}`);
      }
      case "rm": case "delete": {
        await api(`/api/sessions/${args[0]}`, { method: "DELETE" });
        return void reply(`🗑 Đã xoá \`${args[0]}\``);
      }
      case "stopall": {
        const ss = await api("/api/sessions");
        const run = ss.filter((s) => s.status === "running");
        await Promise.all(run.map((s) => api(`/api/sessions/${s.id}/stop`, { method: "POST" })));
        return void reply(`⏸ Đã tạm dừng ${run.length} session đang chạy.`);
      }
      default: return void reply(`Không hiểu lệnh. Gõ ${PREFIX}help`);
    }
  } catch (e) { reply("Lỗi gọi API tool: " + String(e.message)); }
});

// WS mở NGAY từ đầu (không đợi Discord ready): nhờ vậy UI vẫn báo được trạng thái và
// gửi được yêu cầu "Thử lại" kể cả khi bot chưa đăng nhập được Discord.
connectWS();
report();

if (TOKEN) client.login(TOKEN).catch((e) => {
  lastError = "Đăng nhập Discord lỗi: " + e.message;
  console.error("⚠ Bot login lỗi:", e.message, "— bot idle (server/web vẫn chạy).");
  report();
  setInterval(() => {}, 1 << 30);
});
