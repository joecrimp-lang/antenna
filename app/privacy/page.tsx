// MVP trust page. Deliberately a short, plain-language notice rather than
// a full legal document, per the brief ("do not create an overly complex
// legal document"): this product currently only collects an email address
// (plus optional company/job title) via EmailCapture.tsx's early access
// form, nothing else, so the page describes exactly that and nothing more.

import Link from "next/link";
import StaticPage from "../components/StaticPage";

export const metadata = {
  title: "Privacy — Antenna",
};

export default function PrivacyPage() {
  return (
    <StaticPage eyebrow="Trust" title="Privacy">
      <p>
        Antenna is in early development. This page explains what we collect from the early access
        form on this site, and how it is used.
      </p>

      <p>
        <strong>What we collect.</strong> Your email address, and, if you choose to provide them,
        your company name and job title. We do not collect any other personal information through
        this site.
      </p>

      <p>
        <strong>Why we collect it.</strong> To send product updates and communications about
        Antenna&apos;s development and launch. We do not use this information for any other
        purpose, and we do not sell or share it with third parties for marketing purposes.
      </p>

      <p>
        <strong>Storage and use.</strong> Information you provide is stored securely and used only
        for the purposes described above, for as long as is reasonably necessary to do so.
      </p>

      <p>
        <strong>Contact and removal.</strong> To ask a question about this notice, or to request
        that we remove your information, see <Link href="/contact">Contact</Link>.
      </p>
    </StaticPage>
  );
}
