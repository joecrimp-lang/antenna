// Display labels for `signal_type`. Established in Chunk 3 (originally
// inline in app/themes/[slug]/page.tsx as EVIDENCE_SECTIONS) and pulled out
// here in Phase 3B so both the theme page and the new SignalCard component
// (app/components/SignalCard.tsx) share one mapping instead of two copies
// drifting apart. Display-only: Antenna's canonical signal_type taxonomy
// (lib/antennaTaxonomy.ts) has no "partnerships" dimension — "strategy" is
// shown under that label because it reads better to a user, but the
// underlying stored value, taxonomy, and classification logic are
// unchanged.
import { ANTENNA_SIGNAL_TYPES, type AntennaSignalType } from "./antennaTaxonomy";

export const SIGNAL_TYPE_LABELS: Record<AntennaSignalType, string> = {
  projects_launches: "Projects & Launches",
  hiring: "Hiring",
  expenditure: "Expenditure",
  procurement: "Procurement",
  strategy: "Partnerships",
};

// Same order as ANTENNA_SIGNAL_TYPES, paired with its display label — used
// wherever evidence needs to be grouped/iterated by type in a fixed order.
export const SIGNAL_TYPE_SECTIONS: { type: AntennaSignalType; label: string }[] =
  ANTENNA_SIGNAL_TYPES.map((type) => ({ type, label: SIGNAL_TYPE_LABELS[type] }));

export function signalTypeLabel(type: AntennaSignalType | null): string {
  return type ? SIGNAL_TYPE_LABELS[type] : "Uncategorised";
}
