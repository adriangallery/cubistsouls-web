"use client";

import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import { SOULS, vaultEtherscanUrl } from "@/lib/reaper";
import { VESSEL_ABI, splitVessels } from "@/lib/vessel";

// YOUR VESSELS — the unions this wallet holds. A vessel walks and talks like a
// token but is NOT a soul: it renders with its on-chain plaque, its thirty
// members (museum custody, no path out) and its vault. The souls grid receives
// the owned list WITHOUT vessels via useOwnedSplit, so a vessel never renders
// as a mislabeled soul.

const IMG = (id: number) => `/api/img?id=${id}`;
const short = (w: string) => (w && w.length >= 10 ? `${w.slice(0, 6)}…${w.slice(-4)}` : w || "—");

export type VesselCard = { id: number; name: string; members: number[]; vault: `0x${string}` | null };

/// Split the owned list on-chain: vessels out of the souls grid, cards for the wing.
export function useOwnedSplit(owned: number[]): { souls: number[]; vessels: VesselCard[]; readyV: boolean } {
  const client = usePublicClient({ chainId: 1 });
  const [souls, setSouls] = useState<number[]>(owned);
  const [vessels, setVessels] = useState<VesselCard[]>([]);
  const [readyV, setReady] = useState(false);
  const key = owned.join(",");

  useEffect(() => {
    setSouls(owned);
    setVessels([]);
    setReady(false);
    if (!client || !owned.length) {
      setReady(true);
      return;
    }
    let stale = false;
    (async () => {
      const split = await splitVessels(client, owned);
      if (stale) return;
      setSouls(split.souls);
      if (!split.vessels.length) {
        setReady(true);
        return;
      }
      const res = await client.multicall({
        allowFailure: true,
        contracts: split.vessels.flatMap((id) => [
          { address: SOULS, abi: VESSEL_ABI, functionName: "vesselNameOf" as const, args: [BigInt(id)] as const },
          { address: SOULS, abi: VESSEL_ABI, functionName: "membersOf" as const, args: [BigInt(id)] as const },
          { address: SOULS, abi: VESSEL_ABI, functionName: "vesselVault" as const, args: [BigInt(id)] as const },
        ]),
      });
      if (stale) return;
      setVessels(
        split.vessels.map((id, i) => {
          const nameR = res[i * 3];
          const memR = res[i * 3 + 1];
          const vltR = res[i * 3 + 2];
          return {
            id,
            name: nameR?.status === "success" ? String(nameR.result) : "",
            members: memR?.status === "success" ? (memR.result as readonly bigint[]).map(Number) : [],
            vault: vltR?.status === "success" ? ((vltR.result as readonly [string, boolean])[0] as `0x${string}`) : null,
          };
        }),
      );
      setReady(true);
    })().catch(() => !stale && setReady(true));
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, key]);

  return { souls, vessels, readyV };
}

export default function MyVessels({ vessels, mode = "self" }: { vessels: VesselCard[]; mode?: "self" | "public" }) {
  if (!vessels.length) return null;
  return (
    <section className="vessels-mine" aria-label="Vessels">
      <div className="rm-head">
        <span className="rm-title">
          <span className="rm-mark">⚱</span> {mode === "self" ? "YOUR VESSELS" : "VESSELS"}
        </span>
        <span className="rm-meta">
          {vessels.length} communion{vessels.length === 1 ? "" : "s"}
        </span>
        <a className="rm-cta" href="/vessels">
          The wing →
        </a>
      </div>
      <div className="rm-grid">
        {vessels.map((v) => (
          <article className="rm-card ascended" key={v.id}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="vessel-art" src={IMG(v.id)} alt={`Vessel #${v.id}`} loading="lazy" />
            <div className="rm-body">
              <div className="rm-name">
                <span className="rm-mark">⚱</span> {v.name || `Vessel #${v.id}`}
              </div>
              <div className="rm-prog">
                <b>{v.members.length}</b>/30
                <span className="rm-left">souls united</span>
              </div>
              {v.vault ? (
                <a
                  className="rm-vault"
                  href={vaultEtherscanUrl(v.vault)}
                  target="_blank"
                  rel="noreferrer"
                  title="The vessel's vault — reserved for what the museum binds to vessels. The thirty rest in the museum's custody, not here."
                >
                  <span className="rm-vault-mark">⚱</span>
                  <span className="rm-vault-addr">{short(v.vault)}</span>
                  <span className="rm-vault-go">↗</span>
                </a>
              ) : null}
              <div className="rm-marks">
                {v.members.slice(0, 8).map((m) => (
                  <span className="rm-chip" key={m}>
                    #{m}
                  </span>
                ))}
                {v.members.length > 8 ? <span className="rm-chip">+{v.members.length - 8}</span> : null}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
