import Link from "next/link";

const SOULS = "0x9252fdc0b3945203314ea1a9b8d64345bc868406";

// A freed soul, framed (DESIGN_SYSTEM §4 "Card de soul", dir. B). Gold frame →
// art (/api/img?id=N) → cartela with №{id} + status.
//
// `link` controls where the card goes (Adrian 25-jul "pulled from the ash"):
//   • "opensea" — the item on OpenSea. ONLY for the holder's OWN souls (/my-souls).
//   • "gallery" — /gallery. Keeps foreign/recent cards on-site.
//   • "none"    — informative, not clickable. Default: never send a curious
//     visitor off-site from a soul that isn't theirs.
// Museum data shown on the cartela, when the caller has it (/my-souls merges the
// old "exhibits" grid into these cards instead of repeating the gallery twice).
export type SoulCardStats = {
  rate?: number; // MH / hour for this soul
  cohortName?: string; // OG · Era I…IV
  raritySeal?: string; // 🏺 Masterpiece …
  rankTxt?: string; // Rank #123
};

export default function SoulCard({
  id,
  status = "Freed",
  eager = false,
  badge,
  link = "none",
  stamp = true,
  stats,
}: {
  id: number;
  status?: string;
  eager?: boolean;
  badge?: string; // optional trait/cohort label pinned bottom-left
  link?: "opensea" | "gallery" | "none";
  stamp?: boolean;
  stats?: SoulCardStats;
}) {
  const num = String(id).padStart(4, "0");
  const rate =
    stats?.rate != null
      ? `+${stats.rate.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MH/h`
      : null;

  const inner = (
    <>
      <div className="art">
        {stamp ? <span className="stamp">Freed</span> : null}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/img?id=${id}`}
          alt={`Cubist Soul ${num}`}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
        />
        {badge ? <span className="badge">{badge}</span> : null}
      </div>
      <div className="card-meta">
        <span className="id">№{num}</span>
        <span className="st">{rate ?? status}</span>
      </div>
      {stats && (stats.cohortName || stats.raritySeal || stats.rankTxt) ? (
        <div className="card-seals">
          {stats.cohortName ? <span className="tag cohort">{stats.cohortName}</span> : null}
          {stats.raritySeal ? <span className="tag">{stats.raritySeal}</span> : null}
          {stats.rankTxt ? <span className="tag rank">{stats.rankTxt}</span> : null}
        </div>
      ) : null}
    </>
  );

  if (link === "opensea") {
    return (
      <Link className="soul" href={`https://opensea.io/item/ethereum/${SOULS}/${id}`} target="_blank" rel="noopener noreferrer">
        {inner}
      </Link>
    );
  }
  if (link === "gallery") {
    return (
      <Link className="soul" href="/gallery">
        {inner}
      </Link>
    );
  }
  return <div className="soul">{inner}</div>;
}
