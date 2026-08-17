// URL slug <-> canonical theme name mapping for /themes/[slug]. Purely a
// routing/presentation concern — does not touch the canonical taxonomy
// arrays in lib/antennaTaxonomy.ts (kept separate deliberately, since that
// file's own header says the taxonomy itself needs product approval to
// change; this file has nothing to do with what the taxonomy contains,
// only how it's addressed in a URL).

import { ANTENNA_THEMES, type AntennaTheme } from "./antennaTaxonomy";

export function themeToSlug(theme: AntennaTheme): string {
  return theme
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const SLUG_TO_THEME: Record<string, AntennaTheme> = Object.fromEntries(
  ANTENNA_THEMES.map((theme) => [themeToSlug(theme), theme])
) as Record<string, AntennaTheme>;

export function slugToTheme(slug: string): AntennaTheme | null {
  return SLUG_TO_THEME[slug] ?? null;
}
