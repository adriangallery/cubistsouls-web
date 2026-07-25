import Link from "next/link";

// Footer identity is CUBIST SOULS: the diamond on Etherscan + the OpenSea
// collection. Pikkazo is intentionally NOT linked here (Adrian's order 25-jul);
// it survives only in the burn-mechanic copy, never as footer identity.
const DIAMOND = "0x9252fDc0b3945203314Ea1a9b8d64345bc868406";

export default function Footer() {
  return (
    <footer className="foot">
      <div className="wrap">
        <div className="fbrand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/logo-trans.svg" alt="" width={22} height={22} />
          CUBIST SOULS
        </div>
        <div className="flinks">
          <Link href="/">Burn</Link>
          <Link href="/gallery">The Freed</Link>
          <Link href="/my-souls">Your Souls</Link>
          <a href="/builder">Builder</a>
          <a href="https://opensea.io/collection/cubist-souls" target="_blank" rel="noopener noreferrer">OpenSea</a>
        </div>
        <div className="fine">
          Cubist Souls diamond{" "}
          <a href={`https://etherscan.io/address/${DIAMOND}`} target="_blank" rel="noopener noreferrer">
            <code>0x9252…8406</code>
          </a>{" "}
          · Ethereum mainnet · only you can burn what you own.
        </div>
      </div>
    </footer>
  );
}
