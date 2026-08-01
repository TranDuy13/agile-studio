// Q21 — "which sections are now out of date?".
//
// Every block of IR carries `sources[].commit` (stamped by write.js from HEAD at the time the
// section was written), so the question has an exact answer: ask git which files changed between
// that commit and HEAD, and intersect with the files the section actually cites.
//
// Costs nothing but a `git diff --name-only`, so it runs whenever a job is opened and whenever the
// user presses ↻. No model is involved.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { normPath } from "./ir.js";

const pexecFile = promisify(execFile);

async function git(cwd, args) {
  const { stdout } = await pexecFile("git", args, { cwd, windowsHide: true, maxBuffer: 24 * 1024 * 1024 });
  return stdout;
}

// A source can be a file ("src/api/create.ts") or a folder ("src/api/"). A folder is stale when
// anything under it changed, which is why this is a prefix test and not an equality test.
function touches(changed, source) {
  const s = normPath(source).replace(/\/+$/, "");
  if (!s) return false;
  if (changed.has(s)) return true;
  const prefix = s + "/";
  for (const f of changed) if (f.startsWith(prefix)) return true;
  return false;
}

function sourcesOf(ir) {
  const out = [];
  const push = (list) => { for (const x of list || []) if (x?.file) out.push(x); };
  push(ir?.sources);
  for (const b of ir?.blocks || []) push(b.sources);
  return out;
}

// Returns { repo, head, checked, stale: [{ id, docKey, num, files[], edited }], unknown[], error? }
export async function detectStale({ plan, ir, repoPath }) {
  const out = { repo: false, head: "", checked: 0, stale: [], unknown: [], error: null };
  if (!repoPath || !existsSync(repoPath)) { out.error = "Không đọc được thư mục repo của project."; return out; }
  if (!existsSync(`${repoPath}/.git`)) {
    out.error = "Thư mục nguồn không phải repo git — không phát hiện được mục đã cũ.";
    return out;
  }
  out.repo = true;
  try { out.head = (await git(repoPath, ["rev-parse", "--short", "HEAD"])).trim(); }
  catch (e) { out.error = String(e.message).slice(0, 300); return out; }

  // One `git diff` per distinct commit, not per section: a 41-section set typically cites two or
  // three distinct commits.
  const changedBy = new Map();
  const changedFor = async (commit) => {
    if (changedBy.has(commit)) return changedBy.get(commit);
    let set = null;
    try {
      const raw = await git(repoPath, ["diff", "--name-only", `${commit}..HEAD`]);
      set = new Set(raw.split("\n").map((s) => normPath(s)).filter(Boolean));
    } catch {
      set = null;                    // commit no longer reachable (rebased, shallow clone, …)
    }
    changedBy.set(commit, set);
    return set;
  };

  for (const doc of plan?.docs || []) {
    for (const s of doc.sections || []) {
      const body = ir?.[`${doc.key}/${s.num}`];
      if (!body) continue;                         // never written: "pending", not "stale"
      out.checked++;
      const hits = new Set();
      let sawUnknown = false;
      for (const src of sourcesOf(body)) {
        const commit = String(src.commit || s.commit || "").trim();
        if (!commit) { sawUnknown = true; continue; }
        if (commit === out.head) continue;         // written against the current commit
        const changed = await changedFor(commit);
        if (!changed) { sawUnknown = true; continue; }
        if (touches(changed, src.file)) hits.add(normPath(src.file));
      }
      if (hits.size) out.stale.push({ id: s.id, docKey: doc.key, num: s.num, title: s.title,
        files: [...hits].slice(0, 12), edited: !!s.edited });
      else if (sawUnknown) out.unknown.push({ id: s.id, docKey: doc.key, num: s.num });
    }
  }
  return out;
}

// Writes the result back onto the plan. A hand-edited section is still reported stale (the user
// needs to know), but it keeps its `edited` flag so the bulk rewrite skips it (test case 6).
export function applyStale(store, jobId, plan, result) {
  const staleIds = new Set(result.stale.map((r) => r.id));
  const byId = new Map(result.stale.map((r) => [r.id, r]));
  // Sections whose commit git could not resolve (rebased away, shallow clone, or never stamped).
  // "Cannot tell" must not be written down as "fine": clearing an existing stale mark here would
  // quietly promise the content is current when nothing checked it.
  const unknown = new Set(result.unknown.map((r) => r.id));
  let changed = 0;
  for (const doc of plan?.docs || []) {
    for (const s of doc.sections || []) {
      if (staleIds.has(s.id)) {
        if (s.status !== "stale") changed++;
        store.patchPlanSection(jobId, s.id, { status: "stale", staleFiles: byId.get(s.id).files });
      } else if (s.status === "stale" && !unknown.has(s.id)) {
        // Genuinely no longer stale: rewritten since, or the diff came back empty.
        store.patchPlanSection(jobId, s.id, { status: s.edited ? "edited" : "written", staleFiles: null });
        changed++;
      }
    }
  }
  return changed;
}
