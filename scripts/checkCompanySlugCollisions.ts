// Phase 3B — one-off sanity check for app/organisations/[slug]/page.tsx.
// That route matches a URL slug back to a company by slugifying every
// company name and comparing (see lib/companySlug.ts's header for why there
// is no stored slug column). Two different company names could in
// principle slugify to the same string (e.g. punctuation-only differences)
// and silently make one of them unreachable at its expected URL. This
// script has no live database access in the sandbox that built it — run it
// once against the real database before relying on /organisations/[slug]
// in production, and again any time a large batch of companies is added.
//
//   npx tsx scripts/checkCompanySlugCollisions.ts

import { getSupabase } from "../lib/supabase";
import { companyToSlug } from "../lib/companySlug";

async function main() {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("companies").select("id, name");
  if (error) {
    throw new Error(`Could not load companies: ${error.message}`);
  }

  const companies = (data ?? []) as { id: number; name: string }[];
  const bySlug = new Map<string, { id: number; name: string }[]>();

  for (const c of companies) {
    const slug = companyToSlug(c.name);
    const list = bySlug.get(slug) ?? [];
    list.push(c);
    bySlug.set(slug, list);
  }

  const collisions = Array.from(bySlug.entries()).filter(([, list]) => list.length > 1);

  console.log(`Checked ${companies.length} companies -> ${bySlug.size} distinct slugs.`);
  if (collisions.length === 0) {
    console.log("No slug collisions. /organisations/[slug] is safe to rely on as-is.");
    return;
  }

  console.log(`\n${collisions.length} slug collision(s) found — these companies are NOT distinguishable by URL:`);
  for (const [slug, list] of collisions) {
    console.log(`  /organisations/${slug}:`);
    for (const c of list) console.log(`    - id=${c.id} name="${c.name}"`);
  }
  console.log(
    "\nResolve by renaming one of the colliding companies, or by adding a disambiguating slug column " +
      "if this becomes a recurring problem — not attempted automatically here."
  );
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
