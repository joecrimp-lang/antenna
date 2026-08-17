// Phase 3B.2 ("Remove AI-style punctuation", decision doc §2): "Remove em
// dashes throughout the application... Apply to: static UI copy, theme
// descriptions, generated narratives, Antenna Views."
//
// Static UI copy and theme descriptions are hand-written, so removing their
// em dashes was a one-time edit at the source (see lib/themeDefinitions.ts,
// app/page.tsx, and friends). Generated copy (theme narratives, Antenna
// Views) is different: it comes back from an OpenAI call every time a
// generation script runs, so an edit to today's output doesn't stop an em
// dash reappearing on the next run. That's handled two ways together: the
// prompts in scripts/generateThemeNarratives.ts and
// scripts/generateOrganisationNarratives.ts now explicitly instruct the
// model to avoid em dashes, and this function is a deterministic safety net
// applied to whatever comes back before it's stored, so compliance doesn't
// depend on the model actually following that instruction every time.
//
// Deliberately NOT applied to lib/research.ts's signal extraction: that
// prompt and its summary/detail output are raw research methodology, not
// product copy, and are explicitly out of scope for this phase (see the
// Phase 3B.2 delivery report's "Assumptions" section).
export function stripEmDashes(text: string): string {
  if (!text) return text;
  return text
    .replace(/\s+—\s+/g, ", ") // " — " used as a clause break -> comma
    .replace(/—/g, ", ") // any remaining em dash (e.g. word—word) -> comma
    .replace(/\s+,/g, ",") // tidy up a space introduced before the comma
    .replace(/,\s*,/g, ","); // collapse an accidental double comma
}
