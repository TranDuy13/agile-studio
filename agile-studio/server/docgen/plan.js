// Turning a standard + a survey result into the outline the user approves.
//
// The plan is the single denominator for every progress number later on, so it carries the
// declaration (kind, required, accept, hint) forward rather than referring back to the standard.
import { estimatePlan } from "./estimate.js";

const sectionId = (docKey, num) => `${docKey}/${num}`;
export const levelOf = (num) => String(num).split(".").length;

// "6.10" sorts after "6.2", which a string compare gets wrong.
function cmpNum(a, b) {
  const pa = String(a || "").split("."), pb = String(b || "").split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (Number(pa[i]) || 0) - (Number(pb[i]) || 0);
    if (d) return d;
  }
  return 0;
}

function fileNameOf(projectName, doc) {
  const safe = String(projectName || "Project").replace(/[\\/:*?"<>|]+/g, "-").trim();
  return `${safe} — ${doc.short || doc.title}.docx`;
}

function baseSection(docKey, s, extra = {}) {
  return {
    id: sectionId(docKey, s.num),
    num: s.num, title: s.title, kind: s.kind,
    required: !!s.required, hint: s.hint || "",
    accept: s.accept || null, from: s.from || [],
    sources: [], note: "", origin: "standard",
    enabled: true, status: "pending", words: 0,
    ...extra,
  };
}

// survey may be null: the outline is then the plain standard, which is what "Áp preset" and a
// failed survey both fall back to.
export function buildPlan({ std, projectName, survey }) {
  const byDoc = new Map((survey?.docs || []).map((d) => [d.key, d]));
  const docs = std.docs.map((doc) => {
    const found = byDoc.get(doc.key);
    const bySection = new Map((found?.sections || []).map((s) => [String(s.num), s]));
    const sections = [];
    for (const s of doc.sections) {
      const hit = bySection.get(String(s.num));
      sections.push(baseSection(doc.key, s, {
        sources: Array.isArray(hit?.sources) ? hit.sources.slice(0, 24) : [],
        note: hit?.reason || "",
        // A required section stays on even when the agent wants to drop it: dropping a required
        // section is the user's call, so it is only *proposed* (note explains why).
        enabled: hit ? (hit.keep !== false || !!s.required) : true,
        proposedDrop: !!hit && hit.keep === false,
      }));
      // Sub-sections follow their parent in numeric order, whatever order the agent listed them in.
      const subs = [...(hit?.subsections || [])].sort((a, b) => cmpNum(a?.num, b?.num));
      for (const sub of subs) {
        if (!sub?.num || !sub?.title) continue;
        sections.push(baseSection(doc.key, { ...s, num: String(sub.num), title: String(sub.title) }, {
          required: false, origin: "agent",
          sources: Array.isArray(sub.sources) ? sub.sources.slice(0, 24) : [],
          hint: s.hint,
        }));
      }
    }
    return { key: doc.key, title: doc.title, short: doc.short || doc.title,
      hint: doc.hint || "", file: fileNameOf(projectName, doc), enabled: true, sections };
  });

  for (const add of survey?.added || []) {
    const doc = docs.find((d) => d.key === add.docKey) || docs[0];
    if (!doc || !add.title) continue;
    const at = doc.sections.findIndex((s) => String(s.num) === String(add.afterNum));
    const num = nextFreeNum(doc, add.afterNum);
    const sec = baseSection(doc.key, {
      num, title: String(add.title), kind: add.kind || "explanation", required: false,
      hint: add.hint || "", accept: { minBlocks: 1, minSources: 1 }, from: [],
    }, { origin: "agent", sources: Array.isArray(add.sources) ? add.sources.slice(0, 24) : [] });
    doc.sections.splice(at >= 0 ? at + 1 : doc.sections.length, 0, sec);
  }

  return { revision: 1, approvedAt: null, engine: "per-doc", docs };
}

// A new section proposed after "8" becomes "8.1", "8.2"… — never renumbering what the standard owns.
function nextFreeNum(doc, afterNum) {
  const base = String(afterNum || doc.sections.length + 1);
  for (let i = 1; i < 40; i++) {
    const candidate = `${base}.${i}`;
    if (!doc.sections.some((s) => String(s.num) === candidate)) return candidate;
  }
  return `${base}.x`;
}

// Applying a revision: keep whatever the user already edited by hand, move enable flags and
// sources across, and add anything new the agent came back with.
export function mergeRevision(plan, next) {
  const out = JSON.parse(JSON.stringify(next));
  const prevById = new Map();
  for (const d of plan?.docs || []) for (const s of d.sections || []) prevById.set(s.id, s);
  for (const d of out.docs) {
    for (const s of d.sections) {
      const prev = prevById.get(s.id);
      if (!prev) continue;
      if (prev.origin === "user") { s.title = prev.title; s.origin = "user"; }
      if (prev.userTitle) { s.title = prev.title; s.userTitle = true; }
      // A section the user switched on or off by hand keeps that state across a revision:
      // asking the agent to reword the outline must not silently re-enable dropped sections.
      if (prev.userEnabled !== undefined) { s.enabled = prev.userEnabled; s.userEnabled = prev.userEnabled; }
    }
    // User-created sections are never dropped by a revision.
    const kept = (plan?.docs || []).find((x) => x.key === d.key)?.sections?.filter((s) => s.origin === "user") || [];
    for (const s of kept) if (!d.sections.some((x) => x.id === s.id)) d.sections.push(s);
  }
  out.revision = (plan?.revision || 1) + 1;
  out.approvedAt = null;
  out.engine = plan?.engine || "per-doc";
  return out;
}

// Preset = the shape of an outline (which sections, in which order, what is on), without the
// project-specific sources. Applying it must leave the plan fully editable afterwards.
export function planToPreset(plan, { name, standardId }) {
  return {
    name: name || "Dàn ý chưa đặt tên", standardId,
    docs: (plan?.docs || []).map((d) => ({
      key: d.key,
      sections: (d.sections || []).map((s) => ({
        num: s.num, title: s.title, kind: s.kind, hint: s.hint, required: s.required,
        accept: s.accept, enabled: s.enabled !== false, origin: s.origin,
      })),
    })),
  };
}

export function applyPreset(plan, preset) {
  const out = JSON.parse(JSON.stringify(plan));
  for (const pd of preset.docs || []) {
    const doc = out.docs.find((d) => d.key === pd.key);
    if (!doc) continue;
    const bySrc = new Map(doc.sections.map((s) => [String(s.num), s]));
    const rebuilt = [];
    for (const ps of pd.sections || []) {
      const cur = bySrc.get(String(ps.num));
      if (cur) {
        rebuilt.push({ ...cur, title: ps.title || cur.title, enabled: ps.enabled !== false });
        bySrc.delete(String(ps.num));
      } else {
        rebuilt.push(baseSection(doc.key, {
          num: ps.num, title: ps.title, kind: ps.kind || "explanation",
          required: !!ps.required, hint: ps.hint || "", accept: ps.accept || { minBlocks: 1 }, from: [],
        }, { origin: ps.origin || "user", enabled: ps.enabled !== false }));
      }
    }
    // Sections the preset never mentions stay, at the end, switched off — nothing disappears silently.
    for (const leftover of bySrc.values()) rebuilt.push({ ...leftover, enabled: false });
    doc.sections = rebuilt;
  }
  out.approvedAt = null;
  return out;
}

export function planStats(plan, depth = "standard") {
  const { tokens, sections } = estimatePlan(plan, depth);
  const docs = (plan?.docs || []).filter((d) => (d.sections || []).some((s) => s.enabled !== false));
  return { estTokens: tokens, sections, docs: docs.length,
    total: (plan?.docs || []).reduce((n, d) => n + (d.sections?.length || 0), 0) };
}
