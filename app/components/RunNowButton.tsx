"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RunNowButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/run-now", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Run failed");
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
        {loading ? "Running..." : "Run now"}
      </button>
      {error && (
        <div style={{ color: "#b00020", fontSize: 13, marginTop: 6 }}>
          {error}
        </div>
      )}
    </div>
  );
}
