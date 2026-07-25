"use client";

import { useCallback, useEffect, useState } from "react";

// A collapsible dashboard panel — the museum's control room drawer.
// Open/closed is remembered per panel id (localStorage) so a curator who folds
// the leaderboard away keeps it folded next visit. Renders open on the server and
// on first paint, then reconciles with the stored preference (no hydration gap:
// the body always exists, only `hidden` flips after mount).
export default function Panel({
  id,
  title,
  meta,
  tall = false,
  wide = false,
  children,
}: {
  id: string;
  title: React.ReactNode;
  meta?: React.ReactNode;
  tall?: boolean; // spans two rows in the dashboard grid (the leaderboard)
  wide?: boolean; // spans both columns (the collection)
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    try {
      if (localStorage.getItem(`cs.panel.${id}`) === "0") setOpen(false);
    } catch {}
  }, [id]);

  const toggle = useCallback(() => {
    setOpen((o) => {
      const next = !o;
      try {
        localStorage.setItem(`cs.panel.${id}`, next ? "1" : "0");
      } catch {}
      return next;
    });
  }, [id]);

  return (
    <section className={`panel${tall ? " tall" : ""}${wide ? " wide" : ""}${open ? "" : " folded"}`}>
      <h2 className="panel-head">
        <button type="button" onClick={toggle} aria-expanded={open} aria-controls={`panel-${id}`}>
          <span className="ph-title">{title}</span>
          {meta ? <span className="ph-meta">{meta}</span> : null}
          <span className="ph-chev" aria-hidden="true">
            ▾
          </span>
        </button>
      </h2>
      <div className="panel-body" id={`panel-${id}`} hidden={!open}>
        {children}
      </div>
    </section>
  );
}
