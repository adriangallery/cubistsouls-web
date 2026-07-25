import type { Metadata } from "next";
import Nav from "../components/Nav";
import Footer from "../components/Footer";
import GalleryGrid from "./GalleryGrid";
import { getFreed } from "@/lib/chain";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "The Freed — Cubist Souls",
  description: "Every soul pulled from the ash — the community's ledger of liberations.",
  openGraph: {
    title: "The Freed — Cubist Souls",
    images: ["https://cubistsouls.vercel.app/api/img?id=136"],
  },
};

export default async function Gallery() {
  const freed = await getFreed();
  const ids = freed.map((e) => e.id);

  return (
    <>
      <Nav active="freed" />

      <section className="section">
        <div className="wrap">
          <div className="sec-head">
            <span className="eyebrow">Freed by fire · the ledger</span>
            <h2>PULLED FROM <em className="hot">THE ASH</em></h2>
          </div>

          {ids.length === 0 ? (
            <div className="gempty">
              Couldn&apos;t reach Ethereum right now. Try again — or see the{" "}
              <a href="https://opensea.io/collection/cubist-souls" target="_blank" rel="noopener noreferrer">
                collection on OpenSea
              </a>
              .
            </div>
          ) : (
            <GalleryGrid freed={ids} />
          )}
        </div>
      </section>

      <Footer />
    </>
  );
}
