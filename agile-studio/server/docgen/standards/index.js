// Standards are DATA, not code (RULESET N3): adding one is adding a file here, the engine
// never changes. Everything downstream — the wizard table, the outline tree, the tooltips,
// the token estimate, the "Đầy đủ" score of D6 — reads from these declarations.
import arc42 from "./arc42.js";
import iso29148 from "./iso29148.js";
import ieee1016 from "./ieee1016.js";
import iso26514 from "./iso26514.js";
import iso15289 from "./iso15289.js";
import { SOURCE_LABELS, KIND_LABELS, KINDS } from "./vocab.js";

export { SOURCE_LABELS, KIND_LABELS };

const ALL = [arc42, iso29148, ieee1016, iso26514, iso15289];

// Fail loudly at boot rather than shipping a standard with a missing hint/accept:
// a section without `hint` has no tooltip, and one without `accept` cannot be scored.
function validate(std) {
  const where = (d, s) => `${std.id}/${d.key}${s ? "#" + s.num : ""}`;
  if (!std.id || !std.label || !Array.isArray(std.docs) || !std.docs.length)
    throw new Error(`docgen: chuẩn "${std.id}" thiếu id/label/docs`);
  for (const d of std.docs) {
    if (!d.key || !d.title || !Array.isArray(d.sections) || !d.sections.length)
      throw new Error(`docgen: tài liệu "${where(d)}" thiếu key/title/sections`);
    const nums = new Set();
    for (const s of d.sections) {
      if (!s.num || !s.title) throw new Error(`docgen: mục ở "${where(d)}" thiếu num/title`);
      if (nums.has(s.num)) throw new Error(`docgen: trùng số mục ${where(d, s)}`);
      nums.add(s.num);
      if (!KINDS.includes(s.kind)) throw new Error(`docgen: kind lạ ở ${where(d, s)}: ${s.kind}`);
      if (!s.hint) throw new Error(`docgen: thiếu hint (tooltip) ở ${where(d, s)}`);
      if (!Array.isArray(s.from) || !s.from.length) throw new Error(`docgen: thiếu from ở ${where(d, s)}`);
      for (const f of s.from)
        if (!SOURCE_LABELS[f]) throw new Error(`docgen: nguồn lạ "${f}" ở ${where(d, s)}`);
      if (!s.accept || typeof s.accept !== "object") throw new Error(`docgen: thiếu accept ở ${where(d, s)}`);
    }
  }
  return std;
}

const BY_ID = new Map(ALL.map((s) => [s.id, validate(s)]));

export function getStandard(id) { return BY_ID.get(id) || null; }

export function countSections(std) {
  return std.docs.reduce((n, d) => n + d.sections.length, 0);
}

// Shape sent to the web app: adds the counts the cards show and resolves source labels
// so the UI never has to know the vocabulary.
export function publicStandard(std) {
  return {
    id: std.id, label: std.label, standard: std.standard, summary: std.summary,
    caveat: std.caveat || null,
    docCount: std.docs.length, sectionCount: countSections(std),
    docs: std.docs.map((d) => ({
      key: d.key, title: d.title, short: d.short || d.title, hint: d.hint || "",
      sections: d.sections.map((s) => ({
        num: s.num, title: s.title, kind: s.kind, kindHint: KIND_LABELS[s.kind],
        required: !!s.required, hint: s.hint,
        from: s.from, fromLabels: s.from.map((f) => SOURCE_LABELS[f]),
        accept: s.accept,
      })),
    })),
  };
}

export function listStandards() { return ALL.map(publicStandard); }

// "Tuỳ chọn": a set assembled from documents of the standards above. It is still only standard
// documents — no home-made outline (Q7). Keys are namespaced because two standards can both
// publish a document called "sdd".
export function composeStandard(picks = []) {
  const docs = [];
  for (const p of picks) {
    const std = BY_ID.get(p.standardId);
    const doc = std?.docs.find((d) => d.key === p.docKey);
    if (doc) docs.push({ ...doc, key: `${std.id}:${doc.key}`, from: std.id, title: doc.title });
  }
  return { id: "custom", label: "Tuỳ chọn", standard: "Ghép từ nhiều chuẩn quốc tế",
    summary: "Bộ tài liệu tự ghép từ các chuẩn có sẵn.", docs };
}

// Every document available for the custom set, flattened for the picker.
export function listComposableDocs() {
  return ALL.flatMap((std) => std.docs.map((d) => ({
    standardId: std.id, standardLabel: std.label, docKey: d.key,
    title: d.title, short: d.short || d.title, hint: d.hint || "", sections: d.sections.length,
  })));
}

// One section of one document, by the ids the UI works with.
export function findSection(stdId, docKey, num) {
  const std = getStandard(stdId);
  const doc = std?.docs.find((d) => d.key === docKey);
  return doc?.sections.find((s) => s.num === num) || null;
}
