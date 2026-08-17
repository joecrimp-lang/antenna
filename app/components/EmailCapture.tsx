"use client";

// Simple demand-validation capture, per the brief: no auth, no accounts, no
// Stripe, no Resend, no alerts — just an email into the existing
// `subscribers` table (schema-only since Build Chunk 1, first real writer
// as of this chunk). Same defensive fetch/try-catch shape as
// RunNowButton.tsx for consistency with the rest of this codebase.

import { useState } from "react";
import styles from "./EmailCapture.module.css";

type Status = "idle" | "loading" | "success" | "error";

export default function EmailCapture({ source }: { source: string }) {
  const [email, setEmail] = useState("");
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
        body: JSON.stringify({ email, source }),
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
      setMessage("You're on the list — we'll be in touch as Antenna develops.");
      setEmail("");
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
      {status === "error" && <p className={styles.error}>{message}</p>}
    </form>
  );
}
