import type { Metadata } from "next";
import Nav from "../components/Nav";
import Footer from "../components/Footer";
import VesselsClient from "./VesselsClient";

// THE VESSELS — the wing of the unions: thirty souls fused inside a canvas
// that once fed a reaper.
//
// HIDDEN until the dev update explaining the deliberate rescue-guard bypass is
// out (transparency precedes the first fusion — same discipline as /raffles):
//   • noindex/nofollow — never indexed;
//   • NOT linked from Nav/Footer — reachable only by typing /vessels.
export const metadata: Metadata = {
  title: "The Vessels — Cubist Souls",
  description: "Thirty souls join forces inside a sacrificed canvas.",
  robots: { index: false, follow: false, nocache: true },
};

export default function VesselsPage() {
  return (
    <>
      <Nav />
      <VesselsClient />
      <Footer />
    </>
  );
}
