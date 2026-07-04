// Quản lý nhiều account Claude Code qua CLAUDE_CONFIG_DIR (cách chính thức Anthropic).
// KHÔNG snapshot/copy credential OAuth — chúng rotate và sẽ hỏng. Chỉ CHỌN config dir.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(execFile);

// accounts.json: [{ id, label, configDir }]
// mỗi account đã `claude auth login` sẵn trong configDir tương ứng.
const DIR = join(homedir(), ".agile-studio");
const CFG = join(DIR, "accounts.json");
const ACCT_DIR = join(DIR, "accounts"); // config dir cho các account thêm qua UI

export function loadAccounts() {
  if (!existsSync(CFG)) {
    // mặc định: 1 account ở ~/.claude (đăng nhập sẵn của máy)
    return [{ id: "default", label: "Default", configDir: join(homedir(), ".claude") }];
  }
  try { const a = JSON.parse(readFileSync(CFG, "utf8")); return Array.isArray(a) && a.length ? a : loadDefault(); }
  catch { return loadDefault(); }
}
function loadDefault() { return [{ id: "default", label: "Default", configDir: join(homedir(), ".claude") }]; }

export function saveAccounts(list) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(CFG, JSON.stringify(list, null, 2));
  return list;
}

// Thư mục config cho 1 account mới (tách biệt để login riêng, không đụng ~/.claude).
export function newAccountConfigDir(id) {
  const dir = join(ACCT_DIR, id);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// Thêm account (đã login sẵn trong configDir) vào danh sách; ghi đè nếu trùng id.
export function addAccount({ id, label, configDir }) {
  const list = loadAccounts().filter((a) => a.id !== id);
  // nếu đang là default duy nhất (chưa có file), giữ lại default khi thêm cái mới
  if (!existsSync(CFG)) list.push(loadDefault()[0]);
  list.push({ id, label: label || id, configDir });
  return saveAccounts(dedupe(list));
}
export function removeAccount(id) { return saveAccounts(loadAccounts().filter((a) => a.id !== id)); }
// Bật/tắt account (tắt = không được orchestrator chọn). Materialize file kể cả default synthetic.
export function setAccountEnabled(id, enabled) {
  const list = loadAccounts().map((a) => (a.id === id ? { ...a, disabled: !enabled } : a));
  return saveAccounts(list);
}
export function enabledAccounts() { return loadAccounts().filter((a) => !a.disabled); }
function dedupe(list) { const seen = new Set(); return list.filter((a) => !seen.has(a.id) && seen.add(a.id)); }

// Đọc credential OAuth từ macOS Keychain hoặc file (Linux/Windows) để lấy access token,
// rồi gọi API usage của Anthropic đọc % dùng trong cửa sổ 5 giờ.
async function readToken(configDir) {
  // Linux/Windows: file .credentials.json trong configDir
  const credFile = join(configDir, ".credentials.json");
  if (existsSync(credFile)) {
    try {
      const d = JSON.parse(readFileSync(credFile, "utf8"));
      const o = d.claudeAiOauth || {};
      if (o.accessToken && Date.now() < (o.expiresAt || 0)) return o.accessToken;
    } catch {}
    return null;
  }
  // macOS: Keychain. Dir mặc định ~/.claude dùng tên THUẦN "Claude Code-credentials"
  // (login bình thường lưu ở đó); dir account riêng dùng tên CÓ HASH theo configDir.
  if (process.platform === "darwin") {
    const hash = createHash("sha256").update(configDir).digest("hex").slice(0, 8);
    const candidates = configDir === join(homedir(), ".claude")
      ? ["Claude Code-credentials", `Claude Code-credentials-${hash}`]
      : [`Claude Code-credentials-${hash}`, "Claude Code-credentials"];
    for (const svc of candidates) {
      try {
        const { stdout } = await pexec("security", ["find-generic-password", "-s", svc, "-w"]);
        const d = JSON.parse(stdout);
        const o = d.claudeAiOauth || {};
        if (o.accessToken && Date.now() < (o.expiresAt || 0)) return o.accessToken;
      } catch {}
    }
  }
  return null;
}

// Đã đăng nhập ở configDir chưa? (đọc được access token còn hạn).
export async function isLoggedIn(configDir) {
  return !!(await readToken(configDir));
}

// Thông tin account claude THẬT (email/tên/plan/org) qua /api/oauth/profile.
export async function fetchProfile(configDir) {
  const token = await readToken(configDir);
  if (!token) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch("https://api.anthropic.com/api/oauth/profile", {
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20", "User-Agent": "agile-studio/0.1" },
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return null;
    const j = await res.json();
    const a = j?.account || {};
    return {
      email: a.email || null, name: a.full_name || a.display_name || null,
      plan: a.has_claude_max ? "max" : a.has_claude_pro ? "pro" : "free",
      org: j?.organization?.name || null,
    };
  } catch { return null; }
}

// Trả về { fiveHourPct, sevenDayPct, resetsAt } hoặc null nếu không đọc được.
export async function fetchUsage(configDir) {
  const token = await readToken(configDir);
  if (!token) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000); // không để treo UI
    const res = await fetch("https://api.anthropic.com/api/oauth/usage", {
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": "agile-studio/0.1",
      },
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return null;
    const j = await res.json();
    return {
      fiveHourPct: j?.five_hour?.utilization ?? null,
      sevenDayPct: j?.seven_day?.utilization ?? null,
      resetsAt: j?.five_hour?.resets_at ?? null,
      sevenDayResetsAt: j?.seven_day?.resets_at ?? null,
      opusPct: j?.seven_day_opus?.utilization ?? null,
      sonnetPct: j?.seven_day_sonnet?.utilization ?? null,
      limits: Array.isArray(j?.limits) ? j.limits.map((l) => ({
        kind: l.kind, group: l.group, percent: l.percent, severity: l.severity,
        resetsAt: l.resets_at, active: l.is_active,
      })) : [],
    };
  } catch {
    return null;
  }
}

// Liệt kê model đang ACTIVE thật của Claude (không hard-code) qua /v1/models bằng token OAuth.
// Trả về [{ id, name }] mới nhất trước, hoặc [] nếu không đọc được token/endpoint.
export async function fetchModels(configDir) {
  const token = await readToken(configDir);
  if (!token) return [];
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": "agile-studio/0.1",
      },
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return [];
    const j = await res.json();
    return (j?.data || []).map((m) => ({ id: m.id, name: m.display_name || m.id }));
  } catch {
    return [];
  }
}

// Chọn account tốt nhất: ưu tiên account đang active nếu còn dưới ngưỡng,
// nếu không thì account có % thấp nhất. threshold mặc định 90%.
export async function pickAccount(accounts, activeId, threshold = 90) {
  const withUsage = await Promise.all(
    accounts.map(async (a) => ({ ...a, usage: await fetchUsage(a.configDir) }))
  );
  const active = withUsage.find((a) => a.id === activeId);
  const pctOf = (a) => a.usage?.fiveHourPct ?? 0;

  // account đang chạy còn dưới ngưỡng → giữ nguyên
  if (active && pctOf(active) < threshold) return { chosen: active, all: withUsage, switched: false };

  // chọn account dưới ngưỡng, % thấp nhất
  const viable = withUsage
    .filter((a) => pctOf(a) < threshold)
    .sort((x, y) => pctOf(x) - pctOf(y));
  if (viable.length) {
    return { chosen: viable[0], all: withUsage, switched: viable[0].id !== activeId };
  }
  // tất cả đều gần cạn → chọn cái reset sớm nhất, báo exhausted
  return { chosen: active || withUsage[0], all: withUsage, switched: false, exhausted: true };
}
