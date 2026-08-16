"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type RunResponse = {
  error?: string;
  companiesProcessed?: number;
  signalsFound?: number;
};

export default function RunNowButton() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleClick() {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/run-now", { method: "POST" });

      // The response might not be JSON at all — e.g. a Vercel timeout or
      // error page — so don't let res.json() throw an unhandled parse
      // error straight into the UI.
      let data: RunResponse | null = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (!res.ok) {
        throw new Error(data?.error || `Request failed (HTTP ${res.status})`);
      }

      const companies = data?.companiesProcessed ?? 0;
      const signals = data?.signalsFound ?? 0;
      setMessage(
        `Done — processed ${companies} compan${companies === 1 ? "y" : "ies"}, found ${signals} new signal${signals === 1 ? "" : "s"}.`
      );
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button onClick={handleClick} disabled={loading}>
        {loading ? "Running... (can take a few minutes)" : "Run now"}
      </button>
      {message && (
        <div style={{ color: "#1a7a3a", fontSize: 13, marginTop: 6 }}>
          {message}
        </div>
      )}
      {error && (
        <div style={{ color: "#b00020", fontSize: 13, marginTop: 6 }}>
          {error}
        </div>
      )}
    </div>
  );
}
