// Keeps the managed doc workspace and requirement uploads durable in the store.
//
// Agents (the spawned Claude CLI) read and write real files with their filesystem tools,
// so disk must stay the working copy. With a DB driver the store is the source of truth and
// disk is a materialized cache: files are written out before a run and read back after it,
// so a second machine pointed at the same database sees the same workspace.
//
// Only "managed" workspaces (agile-studio/projects/<slug>) are mirrored. A "repo" workspace
// lives inside the user's own git repo and is versioned there — never overwrite that from a DB.
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { store, filesInStore } from "./store.js";
import { listDocs } from "./scaffold.js";

// Text formats the workspace is made of. Anything else is left on disk only, so a stray
// binary can't be corrupted by a utf8 round-trip.
// ponytail: extension allow-list instead of content sniffing; widen it if the workspace
// ever needs to carry binaries.
const TEXT_EXT = /\.(md|txt|json|ya?ml|csv|ya?ml|ini|cfg)$/i;
const isText = (p) => TEXT_EXT.test(p);

export const uploadKey = (projectId, requirementId, name) => `${projectId}/${requirementId}/${name}`;

// Write every stored doc file for this project onto disk (DB -> disk). Runs before an agent run.
export function materializeDocs(projectId, ws) {
  if (!filesInStore || ws?.mode !== "managed") return 0;
  let n = 0;
  for (const { path } of store.listDocFiles(projectId)) {
    const content = store.readDocFile(projectId, path);
    if (content == null) continue;
    const fp = join(ws.docsDir, path);
    // Skip identical content so file mtimes stay stable between runs.
    if (existsSync(fp)) { try { if (readFileSync(fp, "utf8") === content) continue; } catch {} }
    mkdirSync(dirname(fp), { recursive: true });
    writeFileSync(fp, content);
    n++;
  }
  return n;
}

// Read the workspace off disk back into the store (disk -> DB). Runs after an agent run and
// after UI edits, and also captures a workspace that only existed on disk until now.
export function syncDocsBack(projectId, ws) {
  if (!filesInStore || ws?.mode !== "managed" || !existsSync(ws.docsDir)) return 0;
  const onDisk = new Set();
  let n = 0;
  for (const { path } of listDocs(ws.docsDir)) {
    if (!isText(path)) continue;
    onDisk.add(path);
    let content; try { content = readFileSync(join(ws.docsDir, path), "utf8"); } catch { continue; }
    if (store.readDocFile(projectId, path) !== content) { store.writeDocFile(projectId, path, content); n++; }
  }
  // Drop entries whose file the agent (or user) deleted.
  for (const { path } of store.listDocFiles(projectId))
    if (isText(path) && !onDisk.has(path)) { store.deleteDocFile(projectId, path); n++; }
  return n;
}

// Put an uploaded attachment in the store and on disk. Disk copy is what an agent reads.
export function saveUpload(projectId, requirementId, name, buf, diskPath) {
  mkdirSync(dirname(diskPath), { recursive: true });
  writeFileSync(diskPath, buf);
  if (filesInStore) store.writeUpload(uploadKey(projectId, requirementId, name), buf.toString("base64"));
}

// Recreate an attachment on disk from the store when it's missing (e.g. another machine).
// Returns true if the file is present on disk afterwards.
export function materializeUpload(projectId, requirementId, name, diskPath) {
  if (existsSync(diskPath)) return true;
  if (!filesInStore) return false;
  const b64 = store.readUpload(uploadKey(projectId, requirementId, name));
  if (b64 == null) return false;
  mkdirSync(dirname(diskPath), { recursive: true });
  writeFileSync(diskPath, Buffer.from(b64, "base64"));
  return true;
}

export function removeUpload(projectId, requirementId, name, diskPath) {
  if (diskPath) { try { rmSync(diskPath); } catch {} }
  if (filesInStore) store.deleteUpload(uploadKey(projectId, requirementId, name));
}
