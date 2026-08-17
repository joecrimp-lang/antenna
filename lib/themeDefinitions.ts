// Phase 3B.1 — "Theme cards refinement" (brief §3): "users should not need
// prior knowledge of media technology terminology." A fixed, one-sentence,
// plain-English definition per canonical theme — the "What is this?" that
// sits above Antenna's own interpretation ("What Antenna is seeing", i.e.
// the Market Signal + Antenna View, which change as evidence changes).
//
// Deliberately static, hand-written content, not generated: there are
// exactly 10 canonical themes (lib/antennaTaxonomy.ts) and what a theme
// MEANS doesn't change with the evidence, so there's nothing to regenerate
// or keep in sync with the research pipeline. Editable in place — this is
// plain data, not methodology.
import { ANTENNA_THEMES, type AntennaTheme } from "./antennaTaxonomy";

export const THEME_DEFINITIONS: Record<AntennaTheme, string> = {
  "AI & Automation":
    "The use of artificial intelligence and automated tooling across content production, operations and decision-making, from generative AI in creative workflows to automated metadata, recommendations and back-office processes.",
  "Cloud & IP Transformation":
    "The shift from traditional broadcast hardware and fixed infrastructure towards software-defined, cloud-based production and distribution workflows.",
  "Streaming & Distribution":
    "How media organisations deliver content directly to audiences: streaming platforms, distribution infrastructure, and the technology used to reach viewers across devices and regions.",
  "Live & Sports Production":
    "The technology used to produce and broadcast live events and sports: remote production, real-time graphics, and the camera, replay and transmission systems that support live broadcasts.",
  "Content Supply Chain & Workflow":
    "The systems that move content from creation to delivery: editing, post-production, media asset management, and the workflow tools that connect each stage of production.",
  "Trust, Security & Provenance":
    "Technology that protects content and verifies its authenticity: anti-piracy, content security, watermarking, and tools that establish where content came from and whether it can be trusted.",
  "Creator & Audience Technology":
    "Tools that connect organisations directly with creators and audiences: creator platforms, audience engagement and personalisation technology, and infrastructure built to support content creators.",
  "Advertising & Monetisation":
    "The technology behind how media organisations generate revenue from content: ad tech, addressable advertising, and subscription or monetisation platforms.",
  "Sustainability & Efficiency":
    "Technology adopted to reduce environmental impact or operating cost: energy-efficient infrastructure, sustainable production practices, and tools that improve operational efficiency.",
  "Connectivity & Infrastructure":
    "The underlying network and infrastructure technology media operations depend on: connectivity, data infrastructure, and the technical foundations that support everything else.",
};

export function themeDefinition(theme: AntennaTheme): string {
  return THEME_DEFINITIONS[theme];
}

// Defensive, dev-time-only completeness check — every canonical theme must
// have a definition, since the UI has no sensible fallback for "no
// definition" the way it does for "no narrative yet" (a definition isn't
// evidence-dependent, so there's no legitimate reason for one to be
// missing).
if (process.env.NODE_ENV !== "production") {
  const missing = ANTENNA_THEMES.filter((t) => !THEME_DEFINITIONS[t]);
  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(`lib/themeDefinitions.ts is missing definitions for: ${missing.join(", ")}`);
  }
}
