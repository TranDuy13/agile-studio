// SQLite backend via node:sqlite (built-in, sync, no native compile, no extra deps).
// Stores the whole domain snapshot as a single JSON document row. For personal/local
// use this is plenty; it also lets a machine keep its state in one portable .sqlite file.
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { config } from "../config.js";
import { readStudioJson } from "./json.js";

export function makeSqliteBackend() {
  mkdirSync(config.dataDir, { recursive: true });
  const path = process.env.SQLITE_PATH || join(config.dataDir, "studio.sqlite");
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK (id = 1), doc TEXT)");
  const upsert = db.prepare("INSERT INTO state(id, doc) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET doc = excluded.doc");

  const backend = {
    seededFrom: null, // set when the first load migrated an existing studio.json
    load() {
      const row = db.prepare("SELECT doc FROM state WHERE id = 1").get();
      if (row) return JSON.parse(row.doc);
      const migrated = readStudioJson(); // one-time migration from studio.json, or null when fresh
      backend.seededFrom = migrated ? "studio.json" : null;
      if (migrated) console.log(`storage sqlite: DB rỗng → nạp dữ liệu sẵn có từ studio.json (${path})`);
      return migrated;
    },
    save(data) { upsert.run(JSON.stringify(data)); },
    ping() { db.prepare("SELECT 1").get(); },
  };
  return backend;
}
