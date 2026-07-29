// Token forecasting (Q22).
//
// These numbers are a coarse model, not a measurement: cost per section is dominated by how much
// of the repository the agent has to read, which we can only guess from the number of sources
// attached to the section. Everything the UI shows from here is labelled as an estimate, and the
// real figure replaces it per section as the run progresses.
const SECTION_BASE = { reference: 58000, howto: 54000, explanation: 50000, tutorial: 60000 };
const PER_SOURCE = 12000;
const PER_MUSTHAVE = { table: 6000, figure: 7000, flow: 8000, code: 3000 };
const DEPTH_FACTOR = { overview: 0.7, standard: 1, detailed: 1.35 };

// Reading the repo once and proposing an outline: mostly a function of how many sections the
// standard asks the agent to reason about.
export function estimateSurvey(sectionCount) {
  return Math.round(100000 + 6500 * sectionCount);
}

// Re-proposing an outline reuses the facts already gathered, so it is far cheaper.
export function estimateRevise(sectionCount) {
  return Math.round(20000 + 1500 * sectionCount);
}

export function estimateSection(section, depth = "standard") {
  const base = SECTION_BASE[section.kind] ?? SECTION_BASE.reference;
  const sources = Array.isArray(section.sources) ? section.sources.length : (section.from?.length || 1);
  const musts = (section.accept?.mustHave || []).reduce((n, m) => n + (PER_MUSTHAVE[m] || 0), 0);
  const factor = DEPTH_FACTOR[depth] ?? 1;
  return Math.round((base + sources * PER_SOURCE + musts) * factor);
}

// Whole plan: only sections that are still switched on count.
export function estimatePlan(plan, depth = "standard") {
  let tokens = 0, sections = 0;
  for (const d of plan?.docs || []) {
    for (const s of d.sections || []) {
      if (s.enabled === false) continue;
      tokens += estimateSection(s, depth);
      sections++;
    }
  }
  return { tokens, sections };
}

// Rough conversion to "how many 5h windows is that". tokensPer5h is a setting because the real
// value depends on plan and model; the dialog says so out loud.
export function windowsOf(tokens, tokensPer5h = 2000000) {
  const per = Math.max(1, Number(tokensPer5h) || 2000000);
  return tokens / per;
}

export function formatTokens(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(n >= 10000000 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (n >= 1000) return Math.round(n / 1000) + "K";
  return String(n);
}
