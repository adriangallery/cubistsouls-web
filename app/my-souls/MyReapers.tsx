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
  ensNameOf,
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

// The reaper as the chain currently has it: its marks, and the tide if its vault
// keeps souls. One source for the art everywhere — the site can never show a
// reaper the token itself would not.
// Bump when the compositor's output changes: it retires every cached image in
// every browser at once. (Entries served during the flaky-read window were dry
// when they should have been drowned, and a browser has no way to know that.)
const ART_VERSION = "t2";
const IMG = (id: number, kept = 0) => `/api/reaper-img?id=${id}&kept=${kept}&v=${ART_VERSION}`;
/// The museum's ceiling on the souls-behind bonus (mirrors weightParams).
const BEHIND_CAP = 30;

/// One measure of a reaper's power. They stack, so a new one is a new line — not
/// a redesign.
function PowerBar({
  label,
  value,
  max,
  note,
  tone = "fire",
}: {
  label: string;
  value: number;
  max: number;
  note?: string;
  tone?: "fire" | "order";
}) {
  const pct = Math.min(100, max > 0 ? Math.round((value / max) * 100) : 0);
  return (
    <div className={`rm-power rm-power-${tone}`}>
      <div className="rm-bar" role="progressbar" aria-valuenow={value} aria-valuemax={max} aria-label={label}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="rm-prog">
        <b>{value}</b>/{max}
        <span className="rm-power-label">{label}</span>
        {note ? <span className="rm-left">{note}</span> : null}
      </div>
    </div>
  );
}

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
  // which name was just copied, so the holder gets an answer to their click
  const [copied, setCopied] = useState<number | null>(null);
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
          // an ascended reaper is drawn by the compositor (it knows the tide); a
          // soul still climbing keeps the crisp local vector stack
          const stack = e.isReaper ? [] : layerData ? composeStack(e.id, layerData, e.marks) : [];
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
                  <img
                    className="lyr"
                    src={IMG(e.id, vaults.get(e.id)?.kept ?? 0)}
                    alt={`Soul #${e.id}`}
                    loading="lazy"
                  />
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
                <PowerBar
                  label="souls consumed"
                  value={e.consumed}
                  max={ASCEND_AT}
                  note={e.isReaper ? "ascended 🜃" : `${left} to ascend`}
                />
                {e.isReaper && vaults.get(e.id)?.deployed ? (
                  <PowerBar
                    label="souls behind it"
                    value={vaults.get(e.id)!.kept ?? 0}
                    max={BEHIND_CAP}
                    tone="order"
                    note={
                      (vaults.get(e.id)!.kept ?? 0) >= BEHIND_CAP
                        ? "at the ceiling"
                        : `+${vaults.get(e.id)!.kept ?? 0} tickets`
                    }
                  />
                ) : null}
                {e.isReaper && mode === "self" && vaults.get(e.id)?.deployed ? (
                  <button className="rm-reinforce" onClick={() => setReinforcing(e.id)}>
                    🜃 Place souls behind it
                  </button>
                ) : null}
                {e.isReaper && vaults.get(e.id)?.deployed ? (
                  <div className="rm-vault">
                    <span className="rm-vault-mark">⚱</span>
                    {/* The name IS the address: anyone can send here from any
                        wallet. Click copies it, because that is what a holder
                        wants to do with it. */}
                    <button
                      className="rm-vault-name"
                      onClick={() => {
                        navigator.clipboard?.writeText(ensNameOf(e.id));
                        setCopied(e.id);
                        setTimeout(() => setCopied((c) => (c === e.id ? null : c)), 1400);
                      }}
                      title={`Copy ${ensNameOf(e.id)} — anyone can send ether or an NFT to this name, from any wallet`}
                    >
                      {copied === e.id ? "copied ✓" : ensNameOf(e.id)}
                    </button>
                    <span className="rm-vault-eth">{fmtVaultEth(vaults.get(e.id)!.eth)}</span>
                    <a
                      className="rm-vault-go"
                      href={vaultEtherscanUrl(vaults.get(e.id)!.account)}
                      target="_blank"
                      rel="noreferrer"
                      title="The vault on Etherscan"
                    >
                      ↗
                    </a>
                  </div>
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
