"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePublicClient } from "wagmi";
import {
  loadLayerData,
  composeStack,
  getReaperVaults,
  vaultEtherscanUrl,
  fmtVaultEth,
  type LayerData,
  type ReaperVault,
} from "@/lib/reaper";
import styles from "./reapers.module.css";

// THE ORDER — the public leaderboard of Soul Reapers: every soul (any holder) that
// crossed 30 souls consumed and earned the rename. Data is derived from the
// ReaperAscended events server-side (getReapers, same pattern as The Freed) and
// handed down; the art is composed HERE with the vector engine so each reaper shows
// its marks (never a blend over the flat PNG).
//
// THE ORDER IS CLOSED (03-ago 2026, ReaperFacetV4): the roster is final at twelve.
// The cards are the whole point of the page now — no mark chips (every member sits
// at 30, so all four milestones are unanimous and the chips said nothing). Beneath
// them, AT THE THRESHOLD: the two souls that were still climbing when the doors
// shut (0<consumed<30). They can never ascend; they are shown as record, not as a
// leaderboard of aspirants.

export type OrderEntry = {
  id: number;
  consumed: number;
  marks: number[];
  holder: string;
  ascendedAt?: number | null;
};
export type RisingEntry = { id: number; consumed: number; marks: number[]; holder?: string };

// The composed art, which now carries the tide as well as the marks. The souls
// the vault keeps go in the URL on purpose: the art changes whenever they do, so
// the address has to change with it or a browser will keep showing yesterday's
// tide for as long as it feels like.
// Bump when the compositor's output changes: it retires every cached image in
// every browser at once. (Entries served during the flaky-read window were dry
// when they should have been drowned, and a browser has no way to know that.)
const ART_VERSION = "t2";
const IMG = (id: number, kept = 0) => `/api/reaper-img?id=${id}&kept=${kept}&v=${ART_VERSION}`;
const SOULS_OS = "0x9252fdc0b3945203314ea1a9b8d64345bc868406";

const short = (w: string) => (w && w.length >= 10 ? `${w.slice(0, 6)}…${w.slice(-4)}` : w || "—");
const ascDate = (ts?: number | null) =>
  ts ? new Date(ts * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : null;

export default function TheOrder({
  live = false,
  reapers = [],
  rising = [],
}: {
  live?: boolean;
  reapers?: OrderEntry[];
  rising?: RisingEntry[];
}) {
  const [layerData, setLayerData] = useState<LayerData | null>(null);
  useEffect(() => {
    loadLayerData().then(setLayerData).catch(() => {});
  }, []);

  const ascended = live ? reapers : [];

  // The vaults of the Order — one ERC-6551 account per ascended reaper, read
  // straight from the diamond (the facet reverts for anything not ascended).
  const client = usePublicClient();
  const [vaults, setVaults] = useState<Map<number, ReaperVault>>(new Map());
  const vaultKey = ascended.map((r) => r.id).join(",");
  useEffect(() => {
    if (!client || !vaultKey) return;
    const ids = vaultKey.split(",").map(Number);
    getReaperVaults(client, ids).then(setVaults).catch(() => {});
  }, [client, vaultKey]);

  return (
    <>
      {/* THE prominent spot — real ascended reapers, or the reserved plate. */}
      {ascended.length > 0 ? (
        <OrderGrid list={ascended} layerData={layerData} vaults={vaults} />
      ) : (
        <div className={styles.orderEmpty}>
          <span className={styles.orderScythe}>🜃</span>
          <p className={styles.orderEmptyLead}>The Order could not be read.</p>
          <p className={styles.orderEmptySub}>
            The reapers are on chain — this is a reader hiccup, not an empty roster.
          </p>
        </div>
      )}

      {/* AT THE THRESHOLD — the souls the closure sealed mid-climb. Record, not race. */}
      {rising.length > 0 && (
        <div className={styles.rising}>
          <div className={styles.risingHead}>
            <span className={styles.risingKick}>At the threshold</span>
            <span className={styles.risingSub}>still climbing when the Order closed · sealed here</span>
          </div>
          <ul className={styles.risingList}>
            {rising.map((r) => {
              const pct = Math.min(100, (r.consumed / 30) * 100);
              return (
                <li className={styles.risingRow} key={r.id}>
                  <span className={styles.risingArt}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={IMG(r.id)} alt={`Soul #${r.id}`} loading="lazy" />
                  </span>
                  <a
                    className={styles.risingId}
                    href={`https://opensea.io/item/ethereum/${SOULS_OS}/${r.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    #{r.id}
                  </a>
                  <span className={styles.risingBar}>
                    <span className={styles.risingBarFill} style={{ width: `${pct}%` }} />
                  </span>
                  <span className={styles.risingCount}>
                    <b>{r.consumed}</b>
                    <i>/30</i>
                  </span>
                  {r.holder && /^0x[0-9a-fA-F]{40}$/.test(r.holder) ? (
                    <Link className={styles.risingHolder} href={`/curator/${r.holder}`}>
                      {short(r.holder)} →
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}

function OrderGrid({
  list,
  layerData,
  vaults,
}: {
  list: OrderEntry[];
  layerData: LayerData | null;
  vaults: Map<number, ReaperVault>;
}) {
  return (
    <div className={styles.orderGrid}>
      {list.map((r, i) => {
        // the compositor draws a member of the Order: it is the only place that
        // knows how deep the water has taken it
        const stack: string[] = [];
        return (
          <article className={styles.orderCard} key={`${r.id}-${i}`}>
            <div className="tryon-stack">
              <span className={styles.orderRank} title="Order of ascension">#{i + 1}</span>
              {stack.length ? (
                stack.map((src, j) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={`${src}-${j}`} className="lyr" src={src} alt="" loading="lazy" />
                ))
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className="lyr"
                  src={IMG(r.id, vaults.get(r.id)?.kept ?? 0)}
                  alt={`Soul Reaper #${r.id}`}
                  loading="lazy"
                />
              )}
            </div>
            <div className={styles.orderBody}>
              <div className={styles.orderName}>
                <span className={styles.orderMark}>🜃</span> Soul Reaper <b>#{r.id}</b>
              </div>
              <div className={styles.orderConsumed}>
                <span className="ico">🔥</span> Souls Consumed <b>{r.consumed}</b>
              </div>
              {r.holder && /^0x[0-9a-fA-F]{40}$/.test(r.holder) ? (
                <Link className={styles.orderHolder} href={`/curator/${r.holder}`}>
                  held by {short(r.holder)} →
                </Link>
              ) : (
                <span className={styles.orderHolder} aria-disabled="true">
                  held by {short(r.holder)}
                </span>
              )}
              {ascDate(r.ascendedAt) ? (
                <div className={styles.orderAscended}>Ascended {ascDate(r.ascendedAt)}</div>
              ) : null}
              {vaults.get(r.id)?.deployed ? (
                <a
                  className={styles.orderVault}
                  href={vaultEtherscanUrl(vaults.get(r.id)!.account)}
                  target="_blank"
                  rel="noreferrer"
                  title="The reaper's vault — an on-chain account bound to the token itself. It travels with the reaper, wherever it hangs."
                >
                  <span className={styles.orderVaultMark}>⚱</span> vault{" "}
                  {short(vaults.get(r.id)!.account)} · {fmtVaultEth(vaults.get(r.id)!.eth)} ↗
                </a>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}
