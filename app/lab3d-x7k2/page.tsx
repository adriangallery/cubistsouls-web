// EXTRUSION LAB — hidden test page (not linked anywhere, noindex).
// Rebuilds a soul from its 8 official vector trait plates, extrudes every
// layer into real 3D geometry and hangs it under studio lighting.
import type { Metadata } from "next";
import Extrude3D from "./Extrude3D";
import "./lab3d.css";

export const metadata: Metadata = {
  title: "Extrusion Lab — Cubist Souls",
  robots: { index: false, follow: false },
};

export default function Lab3DPage() {
  return <Extrude3D />;
}
