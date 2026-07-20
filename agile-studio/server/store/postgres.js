// Postgres backend: persists the whole domain snapshot as one JSONB document row.
// This is the backend for using the app across several machines against ONE shared
// database (set DATABASE_URL): each server loads the shared state at startup and
// writes changes back. `pg` is imported lazily so json/sqlite users needn't install it.
import { readStudioJson } from "./json.js";

export async function makePostgresBackend() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("STORAGE_DRIVER=postgres requires DATABASE_URL in .env");

  let pg;
  try { pg = (await import("pg")).default; }
  catch { throw new Error("STORAGE_DRIVER=postgres requires the 'pg' package: run `npm install pg`"); }

  const pool = new pg.Pool({ connectionString: url });
  await pool.query("CREATE TABLE IF NOT EXISTS agile_state (id INT PRIMARY KEY CHECK (id = 1), doc JSONB NOT NULL)");

  return {
    async load() {
      const { rows } = await pool.query("SELECT doc FROM agile_state WHERE id = 1");
      if (rows.length) return rows[0].doc;            // JSONB already parsed to an object
      return readStudioJson();                        // one-time migration from studio.json, or null
    },
    async save(data) {
      await pool.query(
        "INSERT INTO agile_state(id, doc) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET doc = excluded.doc",
        [JSON.stringify(data)]);
    },
  };
}
