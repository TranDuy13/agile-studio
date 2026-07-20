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

async function pickBackend() {
  if (driver === "json") return makeJsonBackend();
  if (driver === "sqlite") return makeSqliteBackend();
  if (driver === "postgres") return (await import("./postgres.js")).makePostgresBackend();
  throw new Error(`Invalid STORAGE_DRIVER '${driver}' (use json|sqlite|postgres)`);
}

const backend = await pickBackend();
const data = (await backend.load()) || emptyData();
await backend.save(data); // ensure the backend holds the current snapshot (persists a first-time migration)

// Write-behind: mutations schedule a debounced flush so bursts of log writes batch into one save.
// ponytail: whole-document last-writer-wins + a small debounce window; fine for one-machine-at-a-time
// personal use. Add per-entity writes + row locking if two machines may edit concurrently.
let timer = null;
function flush() { timer = null; Promise.resolve(backend.save(data)).catch((e) => console.error("store persist failed:", e.message)); }
function scheduleSave() { if (!timer) timer = setTimeout(flush, 500); }

// Best-effort flush on shutdown so the last debounced changes survive.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.once(sig, async () => {
    if (timer) { clearTimeout(timer); timer = null; }
    try { await backend.save(data); } catch {}
    process.exit(0);
  });
}

export const store = makeStore(data, scheduleSave);
