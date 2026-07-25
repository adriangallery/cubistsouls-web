"use client";

import { useEffect, useState } from "react";

// Provisional home. The real design system arrives in a later wave (W-D/W1).
// This only proves the new deployment is alive AND that the ported API responds.
export default function Home() {
  const [api, setApi] = useState<string>("checking /api/collection…");

  useEffect(() => {
    fetch("/api/collection")
      .then((r) => r.json())
      .then((j) => setApi(`/api/collection OK — "${j.name}"`))
      .catch(() => setApi("/api/collection FAILED"));
  }, []);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1.25rem",
        background: "#2e0a10",
        color: "#f4ece0",
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        textAlign: "center",
        padding: "2rem",
      }}
    >
      <h1 style={{ fontSize: "clamp(1.25rem, 4vw, 2rem)", fontWeight: 600, letterSpacing: "0.02em", margin: 0 }}>
        CUBIST SOULS — new museum under construction
      </h1>
      <p style={{ opacity: 0.7, fontSize: "0.9rem", margin: 0 }}>{api}</p>
    </main>
  );
}
