import type { Metadata } from "next";
import Nav from "../../components/Nav";
import Footer from "../../components/Footer";
import MineClient from "./MineClient";
import styles from "../giveaways.module.css";

// YOUR ENTRIES — a wallet's own trail through the giveaways: what it's in,
// what closed, what it won. Connect and see; nothing here needs a signature.
export const metadata: Metadata = {
  title: "Your Entries — Cubist Souls",
  description: "Your trail through the giveaways.",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default function MinePage() {
  return (
    <div className={styles.ga}>
      <Nav />
      <MineClient />
      <Footer />
    </div>
  );
}
