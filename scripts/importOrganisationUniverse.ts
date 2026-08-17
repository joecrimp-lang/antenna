// Antenna Phase 2A — Phase 3: import the controlled 40-organisation
// universe (20 buyers + 20 vendors) from "Antenna_Top20_Buyers_and_Vendors
// .xlsx", the source of truth supplied for this phase.
//
// NOT part of the deployed app, the daily cron, or any Vercel route — run
// once, locally, by a human, after supabase/005_organisation_model.sql:
//
//   set -a; source .env.local; set +a
//   npx tsx scripts/importOrganisationUniverse.ts --dry-run
//   npx tsx scripts/importOrganisationUniverse.ts
//
// What this does, per Phase 2/3 of the brief:
//
//   1. BUYERS (20) — every one of these already exists in `companies`
//      (verified against supabase/schema.sql: all 20 match an existing
//      name exactly, at ranks 1-20 — the spreadsheet itself notes the
//      ranking is "preserved exactly from the previous Top 50 list"). This
//      is a metadata UPDATE only: organisation_type='buyer',
//      priority='high'. No new row, no signal touched.
//
//   2. LEGACY (the other ~30 existing companies, i.e. every company NOT in
//      the 20-buyer list) — per the confirmed decision for this phase, the
//      live research universe is being narrowed to the controlled 40, not
//      left running in parallel. These get organisation_type='buyer'
//      (unchanged from what they've always implicitly been — the original
//      watchlist is entirely media/entertainment companies),
//      priority='low', and research_enabled=false. This does NOT delete
//      the company or any of its signal history — it only stops future
//      research runs from selecting it (lib/runResearch.ts's query now
//      always filters on research_enabled=true). Reversible any time with
//      a single UPDATE.
//
//   3. VENDORS (20) — none of these exist yet (verified: zero name
//      collisions with the current 50 companies). These are new INSERTs,
//      rank continuing after the current max, organisation_type classified
//      per-company (see VENDORS below), priority='high',
//      research_enabled=true. Nothing beyond these 20 rows is invented.
//
// Safe to re-run: every step matches by exact company name first and only
// updates/inserts what's actually different, so running this twice is a
// no-op the second time.

import { getSupabase } from "../lib/supabase";
import type { AntennaOrganisationType } from "../lib/supabase";

type Args = { dryRun: boolean };

function parseArgs(argv: string[]): Args {
  return { dryRun: argv.includes("--dry-run") };
}

// --- Source data (from Antenna_Top20_Buyers_and_Vendors.xlsx) ------------

// Sheet "Top 20 Buyers" — name only needed; these are metadata updates to
// rows that already exist under these exact names.
const BUYER_NAMES: string[] = [
  "The Walt Disney Company",
  "Netflix",
  "NBCUniversal",
  "Warner Bros. Discovery",
  "Paramount",
  "Amazon MGM Studios / Prime Video",
  "Apple TV",
  "YouTube",
  "BBC",
  "BBC Studios",
  "Sky",
  "ITV",
  "ITV Studios",
  "Channel 4",
  "Banijay Entertainment",
  "Fremantle",
  "RTL Group",
  "ProSiebenSat.1 Media",
  "ARD",
  "ZDF",
];

// Sheet "Top 20 Vendors". organisation_type is a sub-classification of the
// sheet's flat "vendor" list into the brief's four-way model (platform /
// technology_provider / vendor), based on each row's own "Category/Role"
// column — see ANTENNA_PHASE2A_ARCHITECTURE_AUDIT.md §4 for the reasoning
// and the full table. This is a labeling judgment call, not a methodology
// one: trivially correctable later with
//   update companies set organisation_type = '...' where name = '...';
// if any of these should be classified differently.
const VENDORS: { name: string; website: string; country: string; organisation_type: AntennaOrganisationType }[] = [
  { name: "Amazon Web Services (AWS)", website: "https://aws.amazon.com/media/", country: "USA", organisation_type: "platform" },
  { name: "Adobe", website: "https://www.adobe.com", country: "USA", organisation_type: "vendor" },
  { name: "Blackmagic Design", website: "https://www.blackmagicdesign.com", country: "Australia", organisation_type: "vendor" },
  { name: "Microsoft", website: "https://www.microsoft.com/mediaandentertainment", country: "USA", organisation_type: "platform" },
  { name: "Google Cloud", website: "https://cloud.google.com/solutions/media-entertainment", country: "USA", organisation_type: "platform" },
  { name: "Avid Technology", website: "https://www.avid.com", country: "USA", organisation_type: "vendor" },
  { name: "Grass Valley", website: "https://www.grassvalley.com", country: "USA", organisation_type: "vendor" },
  { name: "Sony Professional Solutions", website: "https://pro.sony", country: "Japan", organisation_type: "vendor" },
  { name: "Cisco", website: "https://www.cisco.com", country: "USA", organisation_type: "technology_provider" },
  { name: "NVIDIA", website: "https://www.nvidia.com", country: "USA", organisation_type: "technology_provider" },
  { name: "Harmonic", website: "https://www.harmonicinc.com", country: "USA", organisation_type: "vendor" },
  { name: "Imagine Communications", website: "https://imaginecommunications.com", country: "Canada", organisation_type: "vendor" },
  { name: "Evertz", website: "https://evertz.com", country: "Canada", organisation_type: "vendor" },
  { name: "Ross Video", website: "https://www.rossvideo.com", country: "Canada", organisation_type: "vendor" },
  { name: "Vizrt", website: "https://www.vizrt.com", country: "Norway", organisation_type: "vendor" },
  { name: "Dalet", website: "https://www.dalet.com", country: "France", organisation_type: "vendor" },
  { name: "Telestream", website: "https://www.telestream.net", country: "USA", organisation_type: "vendor" },
  { name: "Akamai", website: "https://www.akamai.com", country: "USA", organisation_type: "platform" },
  { name: "Dolby Laboratories", website: "https://www.dolby.com", country: "USA", organisation_type: "technology_provider" },
  { name: "EVS Broadcast Equipment", website: "https://evs.com", country: "Belgium", organisation_type: "vendor" },
];

type ExistingCompany = {
  id: number;
  name: string;
  rank: number;
  organisation_type: string | null;
  priority: string | null;
  research_enabled: boolean;
  research_scope_note: string | null;
};
type SupabaseClient = ReturnType<typeof getSupabase>;

// research_scope_note is documentation only (per 005_organisation_model.sql
// — no query anywhere reads it), but it's what makes each research_enabled
// decision explainable later, so this script writes one for all three
// groups, not just the paused one.
const BUYER_NOTE = "Top 20 buyer — Phase 2A controlled research universe (20 buyers + 20 vendors).";
const LEGACY_NOTE =
  "Paused for Phase 2A: outside the controlled 40-organisation universe while research reliability is validated at controlled scale. Not a priority demotion — see `priority`.";
const VENDOR_NOTE = "Top 20 vendor — Phase 2A controlled research universe (20 buyers + 20 vendors).";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const supabase = getSupabase();

  console.log("Antenna Phase 2A — organisation universe import");
  console.log(args.dryRun ? "(dry run — no writes)" : "(live run)");
  console.log("");

  const { data, error } = await supabase
    .from("companies")
    .select("id, name, rank, organisation_type, priority, research_enabled, research_scope_note");
  if (error || !data) throw new Error(`Could not load companies: ${error?.message}`);
  const existing = data as ExistingCompany[];
  const byName = new Map(existing.map((c) => [c.name.toLowerCase(), c]));

  // --- 1. Buyers: metadata update on existing rows ---
  let buyersUpdated = 0;
  let buyersAlreadyCorrect = 0;
  const buyerWarnings: string[] = [];
  const buyerMatchedIds = new Set<number>();

  for (const name of BUYER_NAMES) {
    const match = byName.get(name.toLowerCase());
    if (!match) {
      buyerWarnings.push(`Buyer "${name}" not found in companies — expected an existing row (see audit). Not inserted (would risk a near-duplicate); please check spelling manually.`);
      continue;
    }
    buyerMatchedIds.add(match.id);
    if (match.organisation_type === "buyer" && match.priority === "high" && match.research_scope_note === BUYER_NOTE) {
      buyersAlreadyCorrect += 1;
      continue;
    }
    console.log(`  buyer: ${match.name} -> organisation_type=buyer, priority=high`);
    if (!args.dryRun) {
      const { error: updateError } = await supabase
        .from("companies")
        .update({ organisation_type: "buyer", priority: "high", research_scope_note: BUYER_NOTE })
        .eq("id", match.id);
      if (updateError) throw new Error(`Failed updating buyer "${match.name}": ${updateError.message}`);
    }
    buyersUpdated += 1;
  }

  // --- 2. Legacy: every other existing company, paused per this phase's
  //        confirmed decision (research narrowed to the controlled 40) ---
  const legacy = existing.filter((c) => !buyerMatchedIds.has(c.id));
  let legacyUpdated = 0;
  let legacyAlreadyCorrect = 0;

  for (const company of legacy) {
    if (
      company.organisation_type === "buyer" &&
      company.priority === "low" &&
      company.research_enabled === false &&
      company.research_scope_note === LEGACY_NOTE
    ) {
      legacyAlreadyCorrect += 1;
      continue;
    }
    console.log(`  legacy: ${company.name} -> organisation_type=buyer, priority=low, research_enabled=false`);
    if (!args.dryRun) {
      const { error: updateError } = await supabase
        .from("companies")
        .update({ organisation_type: "buyer", priority: "low", research_enabled: false, research_scope_note: LEGACY_NOTE })
        .eq("id", company.id);
      if (updateError) throw new Error(`Failed updating legacy company "${company.name}": ${updateError.message}`);
    }
    legacyUpdated += 1;
  }

  // --- 3. Vendors: insert new rows, or update in place if a name already
  //        exists (defensive — verified none do today, but re-running this
  //        script after a manual edit must never create a duplicate) ---
  let vendorsInserted = 0;
  let vendorsUpdated = 0;
  let nextRank = existing.reduce((max, c) => Math.max(max, c.rank), 0) + 1;

  for (const vendor of VENDORS) {
    const match = byName.get(vendor.name.toLowerCase());
    if (match) {
      if (
        match.organisation_type === vendor.organisation_type &&
        match.priority === "high" &&
        match.research_enabled === true &&
        match.research_scope_note === VENDOR_NOTE
      ) {
        continue;
      }
      console.log(`  vendor (existing, updating metadata only): ${vendor.name}`);
      if (!args.dryRun) {
        const { error: updateError } = await supabase
          .from("companies")
          .update({ organisation_type: vendor.organisation_type, priority: "high", research_enabled: true, research_scope_note: VENDOR_NOTE })
          .eq("id", match.id);
        if (updateError) throw new Error(`Failed updating vendor "${vendor.name}": ${updateError.message}`);
      }
      vendorsUpdated += 1;
      continue;
    }

    console.log(`  vendor (new): ${vendor.name} (rank ${nextRank}, ${vendor.organisation_type})`);
    if (!args.dryRun) {
      const { error: insertError } = await supabase.from("companies").insert({
        rank: nextRank,
        name: vendor.name,
        website: vendor.website,
        country: vendor.country,
        organisation_type: vendor.organisation_type,
        priority: "high",
        research_enabled: true,
        research_scope_note: VENDOR_NOTE,
      });
      if (insertError) throw new Error(`Failed inserting vendor "${vendor.name}": ${insertError.message}`);
    }
    nextRank += 1;
    vendorsInserted += 1;
  }

  console.log("\n--- Import complete ---");
  console.log(`Buyers:  ${BUYER_NAMES.length} in source. Updated ${buyersUpdated}, already correct ${buyersAlreadyCorrect}, not found ${buyerWarnings.length}.`);
  console.log(`Legacy:  ${legacy.length} existing companies outside the 40. Paused (research_enabled=false) ${legacyUpdated}, already correct ${legacyAlreadyCorrect}.`);
  console.log(`Vendors: ${VENDORS.length} in source. Inserted ${vendorsInserted}, updated-in-place ${vendorsUpdated}.`);
  if (buyerWarnings.length > 0) {
    console.log(`\n${buyerWarnings.length} warning(s):`);
    for (const w of buyerWarnings) console.log(`  - ${w}`);
  }
  if (args.dryRun) {
    console.log("\nDry run complete — no writes made. Re-run without --dry-run to execute.");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
