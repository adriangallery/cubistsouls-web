"use client";

import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import ReinforceFlow from "./ReinforceFlow";
import {
  loadLayerData,
  composeStack,
  rankName,
  ASCEND_AT,
  getReaperVaults,
  vaultEtherscanUrl,
  fmtVaultEth,
  type LayerData,
  type ReaperState,
  type ReaperVault,
} from "@/lib/reaper";

// YOUR REAPERS — the prominent block, right under the plaque, for the souls THIS
// wallet is powering up (souls-consumed > 0). Adrian 26-jul: "los que queman souls
// deben tener un lugar destacado". Art is composed with the vector engine so each
// soul shows the marks it forged (never a blend over the flat PNG). No reapers in
// progress → one discreet line with a CTA, never a big empty panel.

const IMG = (id: number) => `/api/img?id=${id}`;

export type MineEntry = { id: number; consumed: number; marks: number[]; isReaper: boolean };

// Pull the wallet's in-progress reapers out of the per-owned reaper-state map.
export function mineFrom(reaper: Map<number, ReaperState> | null, owned: number[]): MineEntry[] {
  if (!reaper) return [];
  return owned
    .map((id) => ({ id, ...(reaper.get(id) ?? { consumed: 0, marks: [], isReaper: false }) }))
    .filter((e) => e.consumed > 0)
    .sort((a, b) => b.consumed - a.consumed || a.id - b.id);
}

export default function MyReapers({
  mine,
  mode = "self",
  owned = [],
  onChanged,
}: {
  mine: MineEntry[];
  mode?: "self" | "public";
  owned?: number[];
  onChanged?: () => void;
}) {
  // which reaper's vault the holder is currently stocking
  const [reinforcing, setReinforcing] = useState<number | null>(null);
  // every reaper this wallet holds — none of them may be used as fodder
  const reaperIds = new Set(mine.filter((e) => e.isReaper).map((e) => e.id));
  const [layerData, setLayerData] = useState<LayerData | null>(null);
  useEffect(() => {
    if (mine.length) loadLayerData().then(setLayerData).catch(() => {});
  }, [mine.length]);

  // Vaults exist ONLY for the ascended (the diamond reverts for anyone else);
  // fetched lazily so souls still rising cost zero extra RPC.
  const client = usePublicClient();
  const [vaults, setVaults] = useState<Map<number, ReaperVault>>(new Map());
  const ascendedKey = mine.filter((e) => e.isReaper).map((e) => e.id).join(",");
  useEffect(() => {
    if (!client || !ascendedKey) return;
    const ids = ascendedKey.split(",").map(Number);
    getReaperVaults(client, ids).then(setVaults).catch(() => {});
  }, [client, ascendedKey]);

  // no rite in progress. On a public profile there's nothing to prompt (the visitor
  // can't feed someone else's reaper) → render nothing rather than a dead CTA.
  if (!mine.length) {
    if (mode === "public") return null;
    return (
      <div className="rm-none">
        <span className="rm-none-mark">🜃</span>
        <span>None of your souls carry the fire yet.</span>
        <a className="rm-none-cta" href="/reapers#rite">
          Take up the scythe →
        </a>
      </div>
    );
  }

  return (
    <section className="reapers-mine" aria-label="Reapers">
      <div className="rm-head">
        <span className="rm-title">
          <span className="rm-mark">🜃</span> {mode === "self" ? "YOUR REAPERS" : "REAPERS"}
        </span>
        <span className="rm-meta">{mine.length} in the fire</span>
        {mode === "self" ? (
          <a className="rm-cta" href="/reapers#rite">
            Feed the fire →
          </a>
        ) : null}
      </div>
      <div className="rm-grid">
        {mine.map((e) => {
          const stack = layerData ? composeStack(e.id, layerData, e.marks) : [];
          const pct = Math.min(100, Math.round((e.consumed / ASCEND_AT) * 100));
          const left = Math.max(0, ASCEND_AT - e.consumed);
          return (
            <article className={`rm-card${e.isReaper ? " ascended" : ""}`} key={e.id}>
              <div className="tryon-stack">
                {stack.length ? (
                  stack.map((src, j) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={`${src}-${j}`} className="lyr" src={src} alt="" loading="lazy" />
                  ))
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="lyr" src={IMG(e.id)} alt={`Soul #${e.id}`} loading="lazy" />
                )}
              </div>
              <div className="rm-body">
                <div className="rm-name">
                  {e.isReaper ? (
                    <>
                      <span className="rm-mark">🜃</span> Soul Reaper <b>#{e.id}</b>
                    </>
                  ) : (
                    <>
                      Soul <b>#{e.id}</b> · {rankName(e.consumed)}
                    </>
                  )}
                </div>
                <div className="rm-bar" role="progressbar" aria-valuenow={e.consumed} aria-valuemax={ASCEND_AT}>
                  <span style={{ width: `${pct}%` }} />
                </div>
                <div className="rm-prog">
                  <b>{e.consumed}</b>/{ASCEND_AT}
                  <span className="rm-left">
                    {e.isReaper ? "ascended 🜃" : `${left} to ascend`}
                  </span>
                </div>
                {e.isReaper && vaults.get(e.id)?.deployed ? (
                  <div className="rm-marks">
                    <span
                      className={`rm-behind${(vaults.get(e.id)!.kept ?? 0) > 0 ? " on" : ""}`}
                      title="Souls kept in this reaper's vault. Each adds a ticket to its odds in the draw, up to thirty. They are not burned — but they belong to the reaper: sell it and they go with it."
                    >
                      🜃 {vaults.get(e.id)!.kept || 0} soul{vaults.get(e.id)!.kept === 1 ? "" : "s"} behind it
                    </span>
                  </div>
                ) : null}
                {e.isReaper && mode === "self" && vaults.get(e.id)?.deployed ? (
                  <button className="rm-reinforce" onClick={() => setReinforcing(e.id)}>
                    🜃 Place souls behind it
                  </button>
                ) : null}
                {e.isReaper && vaults.get(e.id)?.deployed ? (
                  <a
                    className="rm-vault"
                    href={vaultEtherscanUrl(vaults.get(e.id)!.account)}
                    target="_blank"
                    rel="noreferrer"
                    title="The reaper's vault — an on-chain account bound to this token. Whoever holds the reaper commands it."
                  >
                    <span className="rm-vault-mark">⚱</span>
                    <span className="rm-vault-addr">
                      {vaults.get(e.id)!.account.slice(0, 6)}…{vaults.get(e.id)!.account.slice(-4)}
                    </span>
                    <span className="rm-vault-eth">{fmtVaultEth(vaults.get(e.id)!.eth)}</span>
                    <span className="rm-vault-go">↗</span>
                  </a>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      {reinforcing !== null && vaults.get(reinforcing)?.account ? (
        <ReinforceFlow
          reaperId={reinforcing}
          vault={vaults.get(reinforcing)!.account}
          // never offer the reaper itself: a token sealed inside its own vault
          // can never be moved again
          // Never offer a reaper as fodder. Its own vault would end up nested
          // inside another reaper's, it would vanish from this panel, and it
          // would travel with a sale of the reaper holding it. (The reaper being
          // reinforced is excluded for a harder reason: a token sealed inside
          // its own vault can never be moved again.)
          eligible={owned.filter((id) => id !== reinforcing && !reaperIds.has(id))}
          onDone={() => onChanged?.()}
          onClose={() => setReinforcing(null)}
        />
      ) : null}
    </section>
  );
}
