import type { Metadata } from "next";
import Nav from "../../components/Nav";
import Footer from "../../components/Footer";
import ManageClient from "./ManageClient";
import styles from "../giveaways.module.css";

// THE MANAGERS' DESK — where a collab manager hangs a giveaway on the wall.
// Access is a Discord login (allowlist or the Collab Manager role); everything
// the desk can do goes through /api/giveaways/manage, which re-checks the
// sealed session on every call — this page is furniture, not the lock.
export const metadata: Metadata = {
  title: "The Desk — Cubist Souls",
  description: "Collab managers only.",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default function ManagePage() {
  return (
    <div className={styles.ga}>
      <Nav />
      <ManageClient />
      <Footer />
    </div>
  );
}
