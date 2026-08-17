// MVP trust page. No dedicated contact address or inbox exists yet in this
// project (checked: no mailto/contact email anywhere in lib/ or app/,
// RESEND_FROM_EMAIL in .env.example is an internal digest sender, not a
// public contact route), so this states that plainly and points back to
// the early access form as the working channel in the meantime, rather
// than inventing an address that would silently go nowhere.

import Link from "next/link";
import StaticPage from "../components/StaticPage";

export const metadata = {
  title: "Contact — Antenna",
};

export default function ContactPage() {
  return (
    <StaticPage eyebrow="Trust" title="Contact">
      <p>
        Antenna is in early development, and a dedicated contact address is not set up yet.
      </p>

      <p>
        In the meantime, the best way to reach us is the early access form on the{" "}
        <Link href="/">homepage</Link>: leave your email (and, if you like, a note in the company
        or job title field) and we&apos;ll follow up directly. A dedicated contact channel will be
        added here once one exists.
      </p>
    </StaticPage>
  );
}
