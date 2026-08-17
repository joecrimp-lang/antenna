"use client";

// Simple demand-validation capture, per the brief: no auth, no accounts, no
// Stripe, no alerts, just a submission into the existing `subscribers`
// table (schema-only since Build Chunk 1; email has been its first real
// writer since Phase 3B).
//
// Phase 3B.2 (decision doc §6/"Early access capture"): company and job
// title are optional context, not required for signup, so they're kept as
// a second, visually secondary row rather than blocking the primary
// email-only path. Both already have columns on `subscribers`
// (`organisation`, `job_title`, since Build Chunk 1) so this is a
// front-end and API-route change only, no migration. Same defensive
// fetch/try-catch shape as RunNowButton.tsx for consistency with the rest
// of this codebase.

import { useState } from "react";
import styles from "./EmailCapture.module.css";

type Status = "idle" | "loading" | "success" | "error";

export default function EmailCapture({ source }: { source: string }) {
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setMessage(null);
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          source,
          company: company.trim() || undefined,
          jobTitle: jobTitle.trim() || undefined,
        }),
      });

      let data: { error?: string } | null = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (!res.ok) {
        throw new Error(data?.error || `Request failed (HTTP ${res.status})`);
      }

      setStatus("success");
      setMessage("You're on the list. We'll be in touch as the product develops.");
      setEmail("");
      setCompany("");
      setJobTitle("");
    } catch (err) {
      setStatus("error");
      setMessage((err as Error).message);
    }
  }

  if (status === "success") {
    return <p className={styles.success}>{message}</p>;
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.row}>
        <input
          type="email"
          required
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={styles.input}
          disabled={status === "loading"}
        />
        <button type="submit" className={styles.button} disabled={status === "loading"}>
          {status === "loading" ? "Submitting…" : "Get early access"}
        </button>
      </div>
      <div className={styles.optionalRow}>
        <input
          type="text"
          placeholder="Company (optional)"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          className={styles.optionalInput}
          disabled={status === "loading"}
        />
        <input
          type="text"
          placeholder="Job title (optional)"
          value={jobTitle}
          onChange={(e) => setJobTitle(e.target.value)}
          className={styles.optionalInput}
          disabled={status === "loading"}
        />
      </div>
      {status === "error" && <p className={styles.error}>{message}</p>}
    </form>
  );
}
