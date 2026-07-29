// Read-only inspection of the project repository: who wrote it, and how big the scope is.
// Every function degrades to a usable answer when the folder is not a git repository at all.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";

const pexec = promisify(execFile);
const UNIT = "\x1f"; // record separator that cannot appear in a name or an email

const SKIP_DIRS = new Set(["node_modules", "dist", "build", "out", "bin", "obj", "vendor",
  "venv", ".venv", "coverage", "target", "__pycache__"]);

async function git(cwd, args, { maxBuffer = 24 * 1024 * 1024 } = {}) {
  const { stdout } = await pexec("git", args, { cwd, maxBuffer, windowsHide: true });
  return stdout;
}

export function isGitRepo(path) {
  return !!path && existsSync(join(path, ".git"));
}

// Normalise so that "Nguyen An", "nguyenan" and "10293847+nguyenan@users.noreply.github.com"
// collapse into one person. Grouping key is the email local part when it looks meaningful,
// otherwise the lower-cased name.
function identityKey(name, email) {
  const local = String(email || "").split("@")[0].toLowerCase()
    .replace(/^\d+\+/, "")          // GitHub noreply prefix
    .replace(/[^a-z0-9]/g, "");
  const flat = String(name || "").toLowerCase().normalize("NFD")
    .replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
  if (local && local.length > 2) return "e:" + local;
  return "n:" + (flat || local || "unknown");
}

// All git identities in the repo, grouped per person, most commits first.
export async function gitAuthors(path) {
  if (!isGitRepo(path)) return { repo: false, groups: [] };
  let out = "";
  try { out = await git(path, ["log", "--no-merges", `--format=%an${UNIT}%ae`]); }
  catch (e) { return { repo: true, error: String(e.message).slice(0, 300), groups: [] }; }

  const byIdentity = new Map();
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const [name, email] = line.split(UNIT);
    const id = `${name}${UNIT}${email}`;
    const e = byIdentity.get(id) || { name, email, commits: 0 };
    e.commits++;
    byIdentity.set(id, e);
  }
  const groups = new Map();
  for (const it of byIdentity.values()) {
    const key = identityKey(it.name, it.email);
    const g = groups.get(key) || { key, label: it.name || it.email, commits: 0, identities: [] };
    g.commits += it.commits;
    g.identities.push(it);
    if (it.commits > (g.identities[0]?.commits || 0)) g.label = it.name || it.email;
    groups.set(key, g);
  }
  const list = mergeNearby([...groups.values()]).sort((a, b) => b.commits - a.commits);
  for (const g of list) g.identities.sort((a, b) => b.commits - a.commits);
  return { repo: true, groups: list };
}

// Second pass: the same person often has a personal e-mail and a work one whose local parts
// differ by a suffix ("minh" / "minh1511"). Merge those, and merge identical display names.
// The 5-character guard keeps short handles from swallowing unrelated people.
function mergeNearby(groups) {
  const out = [];
  const localOf = (g) => g.identities.map((i) => String(i.email || "").split("@")[0].toLowerCase()
    .replace(/^\d+\+/, "").replace(/[^a-z0-9]/g, "")).filter((s) => s.length >= 5);
  const namesOf = (g) => new Set(g.identities.map((i) => String(i.name || "").trim().toLowerCase()).filter(Boolean));
  for (const g of groups) {
    const gl = localOf(g), gn = namesOf(g);
    const twin = out.find((o) => {
      const ol = localOf(o);
      if (gl.some((a) => ol.some((b) => a.startsWith(b) || b.startsWith(a)))) return true;
      return [...namesOf(o)].some((n) => gn.has(n));
    });
    if (twin) {
      twin.identities.push(...g.identities);
      twin.commits += g.commits;
      if (g.commits > twin.commits - g.commits) twin.label = g.label;
    } else out.push(g);
  }
  return out;
}

// Directories worth documenting, one level below the root plus their immediate children.
function walkDirs(root, depth = 2) {
  const dirs = [];
  const walk = (dir, level) => {
    if (level > depth || dirs.length > 400) return;
    let ents; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of ents) {
      if (!ent.isDirectory() || ent.name.startsWith(".") || SKIP_DIRS.has(ent.name)) continue;
      dirs.push(join(dir, ent.name));
      walk(join(dir, ent.name), level + 1);
    }
  };
  walk(root, 1);
  return dirs;
}

// Scope preview shown under the wizard's step 1 (test case 2).
// byAuthor narrows commits AND the file set to what those identities actually touched.
export async function scanPreview({ path, byAuthor = false, authors = [], from = "", to = "" }) {
  if (!path || !existsSync(path)) return { error: "Đường dẫn không tồn tại" };
  const repo = isGitRepo(path);
  const out = { repo, byAuthor: !!byAuthor, commits: 0, totalCommits: 0, dirs: 0, files: 0, authorFiles: 0 };

  out.dirs = walkDirs(path).length;
  if (!repo) {
    // No git: fall back to a plain file count so the wizard still shows something truthful.
    let files = 0;
    const walk = (dir, level) => {
      if (level > 6 || files > 20000) return;
      let ents; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const ent of ents) {
        if (ent.name.startsWith(".") || SKIP_DIRS.has(ent.name)) continue;
        if (ent.isDirectory()) walk(join(dir, ent.name), level + 1); else files++;
      }
    };
    walk(path, 1);
    out.files = files;
    return out;
  }

  const range = [];
  if (from) range.push(`--since=${from}`);
  if (to) range.push(`--until=${to}`);
  const authorArgs = byAuthor
    ? authors.filter(Boolean).map((a) => `--author=${a}`)
    : [];

  try {
    out.totalCommits = Number((await git(path, ["rev-list", "--count", "--no-merges", "HEAD", ...range])).trim()) || 0;
    out.commits = authorArgs.length
      ? Number((await git(path, ["rev-list", "--count", "--no-merges", "HEAD", ...range, ...authorArgs])).trim()) || 0
      : out.totalCommits;
    const tracked = new Set((await git(path, ["ls-files"])).split("\n").map((s) => s.trim()).filter(Boolean));
    out.files = tracked.size;
    if (authorArgs.length) {
      const names = await git(path, ["log", "--no-merges", "--name-only", "--pretty=format:", ...range, ...authorArgs]);
      // Intersect with what is still tracked: history also lists files that were later deleted
      // or renamed, and "đã đụng 7092 file" in a 4561-file repo helps nobody.
      const touched = new Set(names.split("\n").map((s) => s.trim()).filter((f) => f && tracked.has(f)));
      out.authorFiles = touched.size;
      // Directories with fewer than 3 commits from the author go to the appendix, not the main body.
      const perDir = new Map();
      for (const f of touched) {
        const d = dirname(f).split("/")[0] || ".";
        perDir.set(d, (perDir.get(d) || 0) + 1);
      }
      out.thinDirs = [...perDir.entries()].filter(([, n]) => n < 3).length;
      out.authorDirs = perDir.size;
    }
  } catch (e) {
    out.error = String(e.message).slice(0, 300);
  }
  return out;
}
