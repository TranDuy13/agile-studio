// The IR — the JSON shape the writing agent produces and the renderer consumes (README §5).
//
// Two jobs live here and nowhere else:
//   1. NORMALISE. A model returns "nearly right" JSON: a bullets block with `text` instead of
//      `items`, a table whose rows are ragged, a figure without alt text. Repairing that at the
//      boundary means every consumer downstream (viewer, editor, renderer, D6 scoring) can trust
//      the shape without defending itself.
//   2. MEASURE. Page count, table count, figure count and "how many blocks have a real source"
//      are all derived from the IR, never stored twice.
//
// RULESET N2 is enforced here: a block with no `sources` must declare `assumption` or
// `providedBy`. We do not delete an unsourced block — that would hide the problem — we mark it,
// count it, and let the UI and D6 show it.

export const BLOCK_TYPES = ["p", "bullets", "num", "table", "code", "figure", "flow", "refs", "callout"];

const str = (v) => (v == null ? "" : String(v)).replace(/\r\n/g, "\n").trim();
const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

// Sources use repo-relative POSIX paths everywhere: the agent may answer with a Windows path, and
// stale detection compares against `git diff --name-only`, which always speaks POSIX.
export function normPath(p) {
  return str(p).replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

function normSources(v, commit) {
  const out = [];
  for (const s of arr(v)) {
    // "src/api/create.ts" and { file, lines, commit } are both accepted: half the time a model
    // answers with the bare string even when the schema asks for the object.
    const raw = typeof s === "string" ? { file: s } : (s && typeof s === "object" ? s : null);
    if (!raw) continue;
    const file = normPath(raw.file || raw.path);
    if (!file) continue;
    const lines = Array.isArray(raw.lines)
      ? raw.lines.slice(0, 2).map((n) => Number(n) || 0).filter((n) => n > 0)
      : [];
    const row = { file };
    if (lines.length) row.lines = lines;
    // The commit is stamped by the server from HEAD, not taken from the model: stale detection
    // (Q21) is only as good as this field, and a hallucinated sha silently disables it.
    row.commit = str(raw.commit) || commit || "";
    if (!out.some((x) => x.file === row.file && String(x.lines) === String(row.lines))) out.push(row);
  }
  return out.slice(0, 24);
}

// One entry per file: the section-level list answers "which files is this section about", so the
// line ranges of individual blocks are not what matters here.
function dedupeSources(list) {
  const out = [];
  for (const s of list) if (!out.some((x) => x.file === s.file)) out.push({ file: s.file, commit: s.commit });
  return out.slice(0, 24);
}

function normCells(row, width) {
  const cells = arr(row).map((c) => str(c));
  while (cells.length < width) cells.push("");
  return cells.slice(0, width);
}

function normBlock(raw, commit) {
  if (!raw || typeof raw !== "object") return null;
  const t = BLOCK_TYPES.includes(raw.t) ? raw.t : (raw.t === "list" ? "bullets" : "p");
  const b = { t };
  const sources = normSources(raw.sources, commit);
  if (sources.length) b.sources = sources;
  else if (raw.assumption) b.assumption = true;
  else if (raw.providedBy || raw["provided-by-owner"]) b.providedBy = "owner";

  if (t === "p") {
    b.text = str(raw.text || raw.value);
    if (!b.text) return null;
  } else if (t === "bullets" || t === "num") {
    // A model that has nothing to list sometimes emits a single paragraph inside `text`.
    b.items = arr(raw.items).map((x) => str(x)).filter(Boolean);
    if (!b.items.length && str(raw.text)) b.items = str(raw.text).split("\n").map(str).filter(Boolean);
    if (!b.items.length) return null;
    if (t === "num" && raw.restart !== false) b.restart = true;   // numbering resets per section
  } else if (t === "table") {
    const headers = arr(raw.headers).map((x) => str(x));
    const rows = arr(raw.rows).map((r) => arr(r));
    const width = Math.max(headers.length, ...rows.map((r) => r.length), 0);
    if (!width) return null;
    b.headers = normCells(headers, width);
    b.rows = rows.map((r) => normCells(r, width)).filter((r) => r.some(Boolean));
    if (!b.rows.length) return null;
    const widths = arr(raw.widths).map((n) => Number(n)).filter((n) => n > 0);
    if (widths.length === width) b.widths = widths;
    if (str(raw.caption)) b.caption = str(raw.caption);
  } else if (t === "code") {
    b.text = str(raw.text || raw.code);
    if (!b.text) return null;
    b.lang = str(raw.lang).slice(0, 24) || "text";
  } else if (t === "figure") {
    b.src = normPath(raw.src);
    b.caption = str(raw.caption);
    // Alt text is mandatory (N7/WCAG). Falling back to the caption is better than shipping a
    // figure with no alt at all, and `altFromCaption` tells D6 it was not written on purpose.
    b.alt = str(raw.alt);
    if (!b.alt) { b.alt = b.caption; b.altFromCaption = true; }
    if (!b.src && !b.caption && !b.alt) return null;
  } else if (t === "flow") {
    b.steps = arr(raw.steps).map((x) => str(x)).filter(Boolean);
    if (!b.steps.length) return null;
    if (str(raw.caption)) b.caption = str(raw.caption);
  } else if (t === "refs") {
    // [["label", "https://…"], …]; a bare string or { label, url } are both tolerated.
    b.items = arr(raw.items).map((it) => {
      if (Array.isArray(it)) return [str(it[0]), str(it[1])];
      if (it && typeof it === "object") return [str(it.label || it.title), str(it.url || it.href)];
      return [str(it), ""];
    }).filter((p) => p[0] || p[1]);
    if (!b.items.length) return null;
  } else if (t === "callout") {
    b.level = ["info", "warn", "danger"].includes(raw.level) ? raw.level : "info";
    b.text = str(raw.text);
    if (!b.text) return null;
  }
  return b;
}

// raw: whatever the agent wrote. section: the outline row, which owns num/title/kind — the model
// is not allowed to rename a standard's section (N11), so those fields are taken from the plan.
export function normalizeSection(raw, section, { docKey, commit = "", sources = [] } = {}) {
  const body = raw && typeof raw === "object" ? raw : {};
  const blocks = arr(body.blocks).map((b) => normBlock(b, commit)).filter(Boolean);
  const own = normSources(body.sources, commit);
  const ir = {
    doc: docKey || section?.docKey || "",
    section: String(section?.num ?? body.section ?? ""),
    title: section?.title || str(body.title),
    kind: section?.kind || str(body.kind) || "explanation",
    // Section-level sources: what the agent declared, else the union of what its blocks cite, else
    // what the survey attached to the outline row. A section must never look unsourced just because
    // the model put the paths on the blocks and not on the section.
    sources: own.length ? own
      : (blocks.flatMap((b) => b.sources || []).length
        ? dedupeSources(blocks.flatMap((b) => b.sources || []))
        : normSources(sources, commit)),
    traces: arr(body.traces).map((x) => str(x)).filter(Boolean).slice(0, 40),
    blocks,
  };
  if (str(body.summary)) ir.summary = str(body.summary);
  return ir;
}

const WORD_RE = /\s+/;
const wordsIn = (s) => (str(s) ? str(s).split(WORD_RE).length : 0);

export function sectionMetrics(ir) {
  const m = { blocks: 0, words: 0, tables: 0, figures: 0, flows: 0, code: 0, sourced: 0, unsourced: 0 };
  for (const b of ir?.blocks || []) {
    m.blocks++;
    if (b.sources?.length) m.sourced++;
    else if (!b.assumption && !b.providedBy) m.unsourced++;
    if (b.t === "table") { m.tables++; m.words += b.headers.reduce((n, c) => n + wordsIn(c), 0)
      + b.rows.reduce((n, r) => n + r.reduce((k, c) => k + wordsIn(c), 0), 0); }
    else if (b.t === "figure") { m.figures++; m.words += wordsIn(b.caption); }
    else if (b.t === "flow") { m.flows++; m.words += b.steps.reduce((n, s) => n + wordsIn(s), 0); }
    else if (b.t === "code") { m.code++; m.words += Math.round(str(b.text).split("\n").length * 6); }
    else if (b.t === "bullets" || b.t === "num") m.words += b.items.reduce((n, s) => n + wordsIn(s), 0);
    else if (b.t === "refs") m.words += b.items.reduce((n, p) => n + wordsIn(p[0]), 0);
    else m.words += wordsIn(b.text);
  }
  return m;
}

// Pages are an estimate and the UI says so. 420 words to a page at the default theme, plus the
// vertical space a table or a figure takes whatever its word count.
export function pagesOf({ words = 0, tables = 0, figures = 0, flows = 0 }) {
  return Math.max(1, Math.round(words / 420 + tables * 0.34 + (figures + flows) * 0.42));
}

// Roll-up across a whole job: the numbers on the stats rail and on the job card.
export function jobMetrics(irBag, plan) {
  const total = { sections: 0, done: 0, words: 0, tables: 0, figures: 0, flows: 0,
    blocks: 0, sourced: 0, unsourced: 0 };
  const perDoc = new Map();
  for (const d of plan?.docs || []) {
    const row = { key: d.key, title: d.title, file: d.file, sections: 0, done: 0,
      words: 0, tables: 0, figures: 0, flows: 0 };
    for (const s of d.sections || []) {
      if (s.enabled === false || s.status === "skipped") continue;
      row.sections++; total.sections++;
      const ir = irBag?.[`${d.key}/${s.num}`];
      if (!ir) continue;
      const m = sectionMetrics(ir);
      row.done++; total.done++;
      for (const k of ["words", "tables", "figures", "flows"]) { row[k] += m[k]; total[k] += m[k]; }
      for (const k of ["blocks", "sourced", "unsourced"]) total[k] += m[k];
    }
    row.pages = row.done ? pagesOf(row) : 0;
    perDoc.set(d.key, row);
  }
  total.pages = total.done ? pagesOf(total) : 0;
  total.pct = total.sections ? Math.round((total.done / total.sections) * 100) : 0;
  return { total, docs: [...perDoc.values()] };
}
