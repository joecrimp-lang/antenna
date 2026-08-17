// URL slug for /organisations/[slug] (Phase 3B). Deliberately separate from
// lib/themeSlug.ts: themes are a fixed, compile-time list of 10 strings, so
// that file can build a static slug<->theme lookup table once. Companies
// come from the database and can contain characters themes never do
// (periods, parentheses, ampersands, slashes — e.g. "Warner Bros.
// Discovery", "NBCUniversal (Comcast)"), and the list isn't known at build
// time, so there's no equivalent static reverse map here. Matching a slug
// back to a company is done by slugifying every candidate name and
// comparing (see app/organisations/[slug]/page.tsx) rather than a lookup
// table — acceptable at this project's controlled scale (dozens of
// companies, not thousands).
export function companyToSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
