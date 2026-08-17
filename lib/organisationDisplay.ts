// Phase 3B — "Add Buyer/Vendor visibility". The public product only talks
// about two sides of the market: Buyer and Vendor (brief §4/§5/§6). The
// underlying organisation model (Phase 2A, supabase/005_organisation_model
// .sql) deliberately kept four values — buyer / vendor / platform /
// technology_provider — because that distinction is genuinely useful for
// how Antenna curates and scopes the research universe (see
// scripts/importOrganisationUniverse.ts). Phase 3B does not change that
// model or collapse it in the database; this is a DISPLAY-ONLY mapping for
// the front end, the same precedent already established for signal_type
// "strategy" -> "Partnerships" (app/themes/[slug]/page.tsx): platform and
// technology_provider both read as "Vendor" to a user, same as they already
// share research_scope_note "vendor/technology provider universe" framing
// from the Phase 2A import.
import type { AntennaOrganisationType } from "./supabase";

export function organisationTypeLabel(type: AntennaOrganisationType | null): "Buyer" | "Vendor" {
  return type === "buyer" ? "Buyer" : "Vendor";
}

export function isBuyer(type: AntennaOrganisationType | null): boolean {
  return type === "buyer";
}
