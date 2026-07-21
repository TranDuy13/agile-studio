// Pick a storage backend by STORAGE_DRIVER (.env), load the whole snapshot once, and
// expose a synchronous `store` over it. Backends persist the snapshot as one document,
// so switching engines needs no call-site changes (server/index.js imports { store }).
//   json     - single studio.json file (default, zero-config)
//   sqlite   - one portable .sqlite file (node:sqlite, built-in)
//   postgres - one shared database, for using the app across several machines
import { join } from "node:path";
import { config } from "../config.js";
import { emptyData, normalizeData, makeStore } from "./state.js";
import { makeJsonBackend } from "./json.js";
import { makeSqliteBackend } from "./sqlite.js";

const driver = (process.env.STORAGE_DRIVER || "json").toLowerCase();

// Which engine is active, and whether project files (docs workspace + requirement uploads)
// must live in the store. With json the local disk already is the single machine's copy;
// with a DB the files have to travel in the DB, and disk becomes a materialized working copy.
export const storageDriver = driver;
export const filesInStore = driver !== "json";

async function pickBackend() {
  if (driver === "json") return makeJsonBackend();
  if (driver === "sqlite") return makeSqliteBackend();
  if (driver === "postgres") return (await import("./postgres.js")).makePostgresBackend();
  throw new Error(`Invalid STORAGE_DRIVER '${driver}' (use json|sqlite|postgres)`);
}

// Where this driver writes, without leaking the DB password into the UI.
function describeTarget() {
  if (driver === "postgres") {
    const raw = process.env.DATABASE_URL || "";
    if (!raw) return "(chưa đặt DATABASE_URL)";
    try { const u = new URL(raw); return `${u.protocol}//${u.username ? u.username + "@" : ""}${u.host}${u.pathname}`; }
    catch { return "(DATABASE_URL không hợp lệ)"; }
  }
  if (driver === "sqlite") return process.env.SQLITE_PATH || join(config.dataDir, "studio.sqlite");
  return join(config.dataDir, "studio.json");
}

// Live connection state, surfaced through /api/integrations. Without this a DB that is down
// only shows up as a line in the server console, while the UI silently keeps accepting writes.
const status = {
  driver, target: describeTarget(), connected: false,
  error: null, lastOkAt: null, lastErrorAt: null, connectedAt: null,
  seededFrom: null, // set when a fresh DB was migrated from an existing studio.json
};
const msgOf = (e) => String(e?.message || e);
function markOk() { status.connected = true; status.error = null; status.lastOkAt = Date.now(); }
function markFail(e) { status.connected = false; status.error = msgOf(e); status.lastErrorAt = Date.now(); }

let backend = null;
const data = emptyData();

// Replace the live snapshot's contents in place so makeStore's closure keeps seeing updates.
function adopt(merged) { if (merged && merged !== data) Object.assign(data, merged); }

// Connect (or reconnect) and take the backend's document as the truth. Anything written while
// disconnected is therefore dropped on reconnect — the UI says so, and it beats silently
// pushing a half-empty local snapshot over a shared database.
async function connect() {
  const b = await pickBackend();
  const loaded = await b.load();
  backend = b;
  status.seededFrom = b.seededFrom || null;
  if (loaded) adopt(normalizeData(loaded));
  adopt(await b.save(data)); // ensure the backend holds the current snapshot (persists a first-time migration)
  status.connectedAt = Date.now();
  markOk();
  if (b.concurrent) startPolling();
}

// A backend that is unreachable at startup no longer takes the whole server down: the app runs
// from memory in a clearly-degraded state, and the UI can show why and retry (issue 17).
try { await connect(); }
catch (e) {
  markFail(e);
  console.error(`storage (${driver}) không kết nối được: ${msgOf(e)}\n`
    + "  → app chạy tạm bằng bộ nhớ, DỮ LIỆU KHÔNG ĐƯỢC LƯU. Sửa cấu hình rồi bấm 'Thử lại' trên UI.");
}

// Write-behind: mutations schedule a debounced flush so bursts of log writes batch into one save.
// A concurrent backend (postgres) merges under a row lock and returns the merged document, so
// flushing also pulls in other machines' changes — hence the periodic refresh below.
let timer = null, flushing = false;
async function flush() {
  timer = null;
  if (!backend) return; // disconnected: keep serving from memory, the UI shows the state
  if (flushing) { scheduleSave(); return; } // don't overlap read-modify-write cycles
  flushing = true;
  try { adopt(await backend.save(data)); markOk(); }
  catch (e) { markFail(e); console.error("store persist failed:", msgOf(e)); }
  finally { flushing = false; }
}
function scheduleSave() { if (!timer) timer = setTimeout(flush, 500); }

// Concurrent backends: poll so a machine converges on edits made from another machine.
// ponytail: whole-document merge on a fixed interval; fine for a couple of personal machines.
// A busier/real-time setup would want per-row change feeds (LISTEN/NOTIFY) instead of polling.
let poller = null;
function startPolling() {
  if (poller) return;
  poller = setInterval(() => { if (!timer && !flushing) flush(); }, 4000);
}

// Current connection state (probe = actually hit the backend instead of reporting the last write).
export async function storageStatus({ probe = false } = {}) {
  if (probe && backend?.ping) {
    try { await backend.ping(); markOk(); } catch (e) { markFail(e); }
  }
  return {
    ...status, concurrent: !!backend?.concurrent, filesInStore,
    degraded: !backend, pendingWrite: !!timer,
  };
}

// Reconnect / re-verify on demand (the UI's retry button).
export async function retryStorage() {
  if (backend) {
    try {
      if (backend.ping) await backend.ping();
      if (timer) { clearTimeout(timer); timer = null; }
      adopt(await backend.save(data));
      markOk();
    } catch (e) { markFail(e); }
    return storageStatus();
  }
  try { await connect(); } catch (e) { markFail(e); }
  return storageStatus();
}

// Best-effort flush on shutdown so the last debounced changes survive.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.once(sig, async () => {
    if (timer) { clearTimeout(timer); timer = null; }
    try { await backend?.save(data); } catch {}
    process.exit(0);
  });
}

export const store = makeStore(data, scheduleSave);
