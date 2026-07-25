import Link from "next/link";

// A freed soul, framed (DESIGN_SYSTEM §4 "Card de soul", dir. B). Gold frame →
// art (/api/img?id=N) → cartela with №{id} + status. Ember "Freed" stamp.
export default function SoulCard({
  id,
  status = "Freed",
  eager = false,
  badge,
}: {
  id: number;
  status?: string;
  eager?: boolean;
  badge?: string; // optional trait/cohort label pinned bottom-left
}) {
  const num = String(id).padStart(4, "0");
  return (
    <Link className="soul" href={`https://opensea.io/item/ethereum/0x9252fdc0b3945203314ea1a9b8d64345bc868406/${id}`} target="_blank" rel="noopener noreferrer">
      <div className="art">
        <span className="stamp">Freed</span>
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
        <span className="st">{status}</span>
      </div>
    </Link>
  );
}
