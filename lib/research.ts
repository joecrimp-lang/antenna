import OpenAI from "openai";
import type { Company } from "./supabase";

export type ResearchFinding = {
  summary: string;
  detail: string;
  source_url: string;
  source_title: string;
  published_date: string | null;
};

function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY env var");
  return new OpenAI({ apiKey });
}

// Caps how long a single company's OpenAI call can run, so one slow request
// can't keep an entire concurrency group (and thus the whole run) alive
// indefinitely. maxRetries is set to 0 so the SDK doesn't silently retry
// past this budget on its own — a timeout here is just a per-company
// failure, caught and recorded by the caller like any other error.
const PER_COMPANY_TIMEOUT_MS = 25_000;

const PROMPT_TEMPLATE = (company: Company) => `You are monitoring the media & entertainment company "${company.name}"${
  company.website ? ` (${company.website})` : ""
} for PUBLIC signals that suggest FUTURE TECHNOLOGY SPENDING. That means things like:
- capital expenditure or budget statements about cloud, streaming, or data infrastructure
- AI, machine learning, or automation initiatives
- earnings call remarks or executive interviews describing technology investment plans
- press releases about new technology vendor deals or partnerships (e.g. AWS, Azure, GCP, Nvidia, Adobe, Salesforce)
- major technology-related hiring pushes or job postings
- technology RFPs, procurement announcements, or tenders
- acquisitions of technology companies or startups

Search the web for the most recent such signals, ideally from the last 30 days. Only include genuine, specific, sourced findings with a real URL. Do not include generic company background, financial results with no technology angle, or speculation.

Respond with ONLY a JSON array (no markdown fences, no commentary before or after). Each item must have this shape:
{"summary": "one sentence", "detail": "2-4 sentences of supporting context", "source_url": "https://...", "source_title": "the article/press-release title", "published_date": "YYYY-MM-DD or null"}

If you find nothing relevant, respond with exactly: []`;

function extractJsonArray(text: string): unknown {
  const trimmed = text.trim();
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return [];
  }
}

export async function researchCompany(company: Company): Promise<ResearchFinding[]> {
  const client = getOpenAI();
  const model = process.env.OPENAI_MODEL || "gpt-5.6";

  const response = await client.responses.create(
    {
      model,
      tools: [{ type: "web_search_preview" }],
      input: PROMPT_TEMPLATE(company),
    },
    { timeout: PER_COMPANY_TIMEOUT_MS, maxRetries: 0 }
  );

  const text = (response as { output_text?: string }).output_text ?? "";
  const parsed = extractJsonArray(text);
  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null
    )
    .map((item) => ({
      summary: String(item.summary ?? "").trim(),
      detail: String(item.detail ?? "").trim(),
      source_url: String(item.source_url ?? "").trim(),
      source_title: String(item.source_title ?? "").trim(),
      published_date: item.published_date ? String(item.published_date) : null,
    }))
    .filter((f) => f.summary && f.source_url);
}
