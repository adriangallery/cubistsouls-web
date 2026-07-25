import type { Metadata } from "next";
import Nav from "./components/Nav";
import Footer from "./components/Footer";

// Branded 404 — replaces Next's bare default (no nav, no way back). Keeps the
// museum look and points the visitor back into the collection.
export const metadata: Metadata = {
  title: "Lost in the museum — Cubist Souls",
};

export default function NotFound() {
  return (
    <>
      <Nav />
      <main className="wrap" style={{ minHeight: "52vh", display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div className="ms-empty">
          <div className="ms-empty-mark">🖼️</div>
          <p className="ms-empty-lead">This wing is empty.</p>
          <p className="note" style={{ padding: "8px 0 0" }}>
            The page you were looking for isn&apos;t hung here. Head back to the{" "}
            <a href="/">burn hall</a> or wander <a href="/gallery">The Freed</a>.
          </p>
        </div>
      </main>
      <Footer />
    </>
  );
}
