"use client";

// A small "i" affordance that reveals a short explanatory note — used next
// to Momentum/Opportunity labels so the distinction between them is always
// one click away, without cluttering the primary layout with paragraphs of
// methodology text. Click/tap-to-toggle (not hover-only) so it works the
// same on touch devices; closes on a second click or on blur.

import { useState } from "react";
import styles from "./InfoTooltip.module.css";

export default function InfoTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);

  return (
    <span className={styles.wrap}>
      <button
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-label="More information"
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setOpen(false)}
      >
        i
      </button>
      {open && <span className={styles.bubble}>{text}</span>}
    </span>
  );
}
