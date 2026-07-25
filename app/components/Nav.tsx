import Link from "next/link";

// Sticky top bar. Active item shows the ember pill (DESIGN_SYSTEM §4 / dir. B).
// Nav collapses to a horizontally-scrollable link row on mobile (never clipped).
export default function Nav({ active }: { active?: "burn" | "freed" | "souls" | "builder" }) {
  return (
    <nav className="nav">
      <div className="nav-in">
        <Link className="brand" href="/">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/logo-trans.svg" alt="" width={26} height={26} />
          CUBIST SOULS
        </Link>
        <div className="nav-links">
          <Link href="/" className={active === "burn" ? "active" : undefined}>Burn</Link>
          <Link href="/gallery" className={active === "freed" ? "active" : undefined}>The Freed</Link>
          <Link href="/my-souls" className={active === "souls" ? "active" : undefined}>Your Souls</Link>
          <a href="/builder" className={active === "builder" ? "active" : undefined}>Builder</a>
          <a href="https://opensea.io/collection/cubist-souls" target="_blank" rel="noopener noreferrer">OpenSea</a>
        </div>
      </div>
    </nav>
  );
}
