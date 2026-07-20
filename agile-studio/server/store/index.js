// Pick a storage backend by STORAGE_DRIVER (.env), load the whole snapshot once, and
// expose a synchronous `store` over it. Backends persist the snapshot as one document,
// so switching engines needs no call-site changes (server/index.js imports { store }).
//   json     - single studio.json file (default, zero-config)
//   sqlite   - one portable .sqlite file (node:sqlite, built-in)
//   postgres - one shared database, for using the app across several machines
import { emptyData, makeStore } from "./state.js";
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

const backend = await pickBackend();
const data = (await backend.load()) || emptyData();

// Replace the live snapshot's contents in place so makeStore's closure keeps seeing updates.
function adopt(merged) { if (merged && merged !== data) Object.assign(data, merged); }

adopt(await backend.save(data)); // ensure the backend holds the current snapshot (persists a first-time migration)

// Write-behind: mutations schedule a debounced flush so bursts of log writes batch into one save.
// A concurrent backend (postgres) merges under a row lock and returns the merged document, so
// flushing also pulls in other machines' changes — hence the periodic refresh below.
let timer = null, flushing = false;
async function flush() {
  timer = null;
  if (flushing) { scheduleSave(); return; } // don't overlap read-modify-write cycles
  flushing = true;
  try { adopt(await backend.save(data)); }
  catch (e) { console.error("store persist failed:", e.message); }
  finally { flushing = false; }
}
function scheduleSave() { if (!timer) timer = setTimeout(flush, 500); }

// Concurrent backends: poll so a machine converges on edits made from another machine.
// ponytail: whole-document merge on a fixed interval; fine for a couple of personal machines.
// A busier/real-time setup would want per-row change feeds (LISTEN/NOTIFY) instead of polling.
if (backend.concurrent) setInterval(() => { if (!timer && !flushing) flush(); }, 4000);

// Best-effort flush on shutdown so the last debounced changes survive.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.once(sig, async () => {
    if (timer) { clearTimeout(timer); timer = null; }
    try { await backend.save(data); } catch {}
    process.exit(0);
  });
}

export const store = makeStore(data, scheduleSave);
