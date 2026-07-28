import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import CuratorProfile from "./CuratorProfile";

// PUBLIC curator profile — /curator/<0x… | name.eth>. Read-only holder page (the
// productised version of the my-souls dev harness). Client-rendered (wallet reads
// live in the browser), so metadata is server-side but generic-with-identity: the
// rank is a client-computed figure and computing it server-side would cost a full
// board scan per crawl, so we keep the title to the address/ENS (cheap, indexable).

const HEX = /^0x[0-9a-fA-F]{40}$/;
const short = (w: string) => (w && w.length >= 10 ? `${w.slice(0, 6)}…${w.slice(-4)}` : w);

// A valid segment is a 0x address or a dotted name (ENS). Anything else (a stray
// "0x123", "notawallet") is a dead wing → branded 404.
function valid(seg: string): boolean {
  if (HEX.test(seg)) return true;
  return seg.includes(".") && seg.length <= 255 && !seg.startsWith("0x");
}

export async function generateMetadata({ params }: { params: { address: string } }): Promise<Metadata> {
  const raw = decodeURIComponent(params.address || "");
  const label = HEX.test(raw) ? short(raw) : raw;
  const title = `Curator ${label} — Cubist Souls`;
  const description = `${label}'s Cubist Souls — the souls they freed, kept and consumed, their Museum Hours and standing in the museum.`;
  return {
    title,
    description,
    alternates: { canonical: `/curator/${raw}` },
    robots: { index: true, follow: true },
    icons: {
      icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🖼️</text></svg>",
    },
    openGraph: {
      type: "profile",
      title,
      description,
      url: `https://cubistsouls.com/curator/${raw}`,
      images: ["https://cubistsouls.com/api/img?id=136"],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["https://cubistsouls.com/api/img?id=136"],
    },
  };
}

export default function Page({ params }: { params: { address: string } }) {
  const raw = decodeURIComponent(params.address || "");
  if (!valid(raw)) notFound();
  return (
    <Suspense fallback={null}>
      <CuratorProfile param={raw} />
    </Suspense>
  );
}
