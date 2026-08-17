import { Resend } from "resend";
import type { Company, Signal } from "./supabase";

export type DigestItem = Signal & { company: Company };

export async function sendDigestEmail(items: DigestItem[]) {
  if (items.length === 0) return;

  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.DIGEST_EMAIL_TO;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !to || !from) {
    throw new Error(
      "Missing RESEND_API_KEY, DIGEST_EMAIL_TO or RESEND_FROM_EMAIL env vars"
    );
  }

  const resend = new Resend(apiKey);

  const rows = items
    .map(
      (item) => `
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid #e5e5e5;">
            <div style="font-weight:600;">${escapeHtml(item.company.name)}</div>
            <div style="margin:4px 0;">${escapeHtml(item.summary)}</div>
            <div style="color:#555;font-size:14px;">${escapeHtml(item.detail ?? "")}</div>
            <div style="margin-top:6px;font-size:13px;">
              <a href="${item.source_url}">${escapeHtml(item.source_title || item.source_url || "")}</a>
              ${item.published_date ? ` &middot; ${escapeHtml(item.published_date)}` : ""}
            </div>
          </td>
        </tr>`
    )
    .join("");

  const html = `
    <div style="font-family:sans-serif;max-width:640px;margin:0 auto;">
      <h2>New technology-spending signals</h2>
      <p>${items.length} new signal${items.length === 1 ? "" : "s"} found across your watchlist.</p>
      <table style="width:100%;border-collapse:collapse;">${rows}</table>
    </div>`;

  // The Resend SDK does NOT throw on API-level failures (invalid `to`,
  // unverified sending domain, etc.) — it resolves successfully with
  // { data, error }, and the caller is expected to check `error` itself.
  // Previously this call's result was discarded entirely, so a rejected
  // send looked identical to a successful one: no exception, nothing
  // recorded as an error, and the caller (runFullResearch) would go on to
  // mark the signals as emailed even though nothing was actually sent.
  // Throwing here lets the existing try/catch in runFullResearch treat a
  // failed send like any other failure — recorded in runs.error, and
  // critically, it means emailed_at only gets set once we get here without
  // throwing, i.e. after a confirmed successful send.
  const { data, error } = await resend.emails.send({
    from,
    to,
    subject: `Tech spend signals digest: ${items.length} new`,
    html,
  });

  if (error) {
    throw new Error(
      `Resend API error: ${error.message ?? JSON.stringify(error)}`
    );
  }

  return data;
}

function escapeHtml(str: string) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
