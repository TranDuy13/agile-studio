// JSON-file backend (default, zero-config): persists the whole snapshot to
// <DATA_DIR>/studio.json. Kept for single-user local use with no DB to run.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";
import { normalizeData } from "./state.js";

const FILE = join(config.dataDir, "studio.json");

// Read studio.json into the domain shape, or null if it doesn't exist yet.
// Shared with DB backends for one-time migration from a pre-existing JSON file.
export function readStudioJson() {
  return existsSync(FILE) ? normalizeData(JSON.parse(readFileSync(FILE, "utf8"))) : null;
}

export function makeJsonBackend() {
  mkdirSync(config.dataDir, { recursive: true });
  return {
    load() { return readStudioJson() || null; },
    save(data) { writeFileSync(FILE, JSON.stringify(data, null, 2)); },
  };
}
