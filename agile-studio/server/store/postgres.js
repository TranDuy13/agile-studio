// Postgres backend: persists the whole domain snapshot as one JSONB document row.
// This is the backend for using the app across several machines against ONE shared
// database (set DATABASE_URL): each server loads the shared state at startup and
// writes changes back. `pg` is imported lazily so json/sqlite users needn't install it.
//
// Concurrent-edit safety: a naive "write my whole snapshot" would let one machine clobber
// another machine's unrelated changes. Instead every flush runs a locked read-modify-write
// (SELECT ... FOR UPDATE): we re-read the remote document, apply ONLY the entities this
// process changed since its last flush (a diff against lastFlushed), and write the merge
// back. Entities another machine touched but we didn't are preserved; only a genuine
// same-entity concurrent edit is last-writer-wins. The merged doc is returned so the caller
// adopts it, which also lets a machine pick up others' changes (see the refresh loop).
import { readStudioJson } from "./json.js";

// Collections keyed by a numeric `id` (arrays) vs keyed maps; the rest are scalars/objects.
const ID_ARRAYS = ["projects", "requirements", "runs"];
const KEYED_MAPS = ["logs", "sessions", "sessionLogs", "schedules", "docFiles", "uploads"];
const clone = (v) => JSON.parse(JSON.stringify(v));
const eq = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// Apply the delta (cur vs base) onto remote and return the merged document.
export function mergeDoc(remote, cur, base) {
  const m = clone(remote);
  for (const col of ID_ARRAYS) {
    const arr = Array.isArray(m[col]) ? m[col] : (m[col] = []);
    let idx = new Map(arr.map((it, i) => [it.id, i]));
    const baseById = new Map((base?.[col] || []).map((it) => [it.id, it]));
    const curById = new Map((cur?.[col] || []).map((it) => [it.id, it]));
    for (const [id, it] of curById)                           // added / changed here
      if (!eq(it, baseById.get(id))) { if (idx.has(id)) arr[idx.get(id)] = it; else { idx.set(id, arr.length); arr.push(it); } }
    for (const id of baseById.keys())                          // removed here
      if (!curById.has(id) && idx.has(id)) { arr.splice(idx.get(id), 1); idx = new Map(arr.map((it, i) => [it.id, i])); }
    m[col] = arr;
  }
  for (const col of KEYED_MAPS) {
    const dst = m[col] && typeof m[col] === "object" ? m[col] : (m[col] = {});
    const baseMap = base?.[col] || {}, curMap = cur?.[col] || {};
    for (const k of Object.keys(curMap)) if (!eq(curMap[k], baseMap[k])) dst[k] = curMap[k];
    for (const k of Object.keys(baseMap)) if (!(k in curMap)) delete dst[k];
    m[col] = dst;
  }
  if (!eq(cur?.settings, base?.settings)) m.settings = cur?.settings || {};
  m.seq = Math.max(Number(remote?.seq) || 1, Number(cur?.seq) || 1);
  return m;
}

export async function makePostgresBackend() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("STORAGE_DRIVER=postgres requires DATABASE_URL in .env");

  let pg;
  try { pg = (await import("pg")).default; }
  catch { throw new Error("STORAGE_DRIVER=postgres requires the 'pg' package: run `npm install pg`"); }

  const pool = new pg.Pool({ connectionString: url });
  await pool.query("CREATE TABLE IF NOT EXISTS agile_state (id INT PRIMARY KEY CHECK (id = 1), doc JSONB NOT NULL)");

  let lastFlushed = null; // snapshot of what this process last wrote, for the diff

  return {
    concurrent: true, // tells the store layer to also poll for other machines' changes
    async load() {
      const { rows } = await pool.query("SELECT doc FROM agile_state WHERE id = 1");
      const doc = rows.length ? rows[0].doc : readStudioJson(); // JSONB parsed already; else migrate
      lastFlushed = doc ? clone(doc) : null;
      return doc;
    },
    // Locked read-modify-write; returns the merged document to adopt.
    async save(cur) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows } = await client.query("SELECT doc FROM agile_state WHERE id = 1 FOR UPDATE");
        const remote = rows[0]?.doc;
        const merged = remote ? mergeDoc(remote, cur, lastFlushed || cur) : cur;
        await client.query(
          "INSERT INTO agile_state(id, doc) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET doc = excluded.doc",
          [JSON.stringify(merged)]);
        await client.query("COMMIT");
        lastFlushed = clone(merged);
        return merged;
      } catch (e) {
        try { await client.query("ROLLBACK"); } catch {}
        throw e;
      } finally {
        client.release();
      }
    },
  };
}
