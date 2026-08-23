"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePublicClient } from "wagmi";
import {
  loadLayerData,
  composeStack,
  getReaperVaults,
  ensNameOf,
  BEHIND_CAP,
  GROUND_CAP,
  stagesFromKept,
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
// t3 (6-ago): retira las entradas que quedaron envenenadas cuando el mini iba
// ahogado — dos reapers salian rotos en el navegador aunque el servidor los
// servia bien. Con el cache largo de /api/reaper-img esto ya no deberia repetirse.
const ART_VERSION = "e1"; // the ground: reapers past thirty kept souls repaint
// `c` (souls consumed) and `kept` are both things the page already knows, and
// passing them means the compositor needs NO chain read at all: the marks and
// both stages of the art are arithmetic on these two numbers. That is what keeps
// sixteen cards from racing a public gateway and losing.
const IMG = (id: number, kept = 0, consumed?: number) =>
  `/api/reaper-img?id=${id}&kept=${kept}${consumed === undefined ? "" : `&c=${consumed}`}&w=768&v=${ART_VERSION}`;
const SOULS_OS = "0x9252fdc0b3945203314ea1a9b8d64345bc868406";

const short = (w: string) => (w && w.length >= 10 ? `${w.slice(0, 6)}…${w.slice(-4)}` : w || "—");
const ascDate = (ts?: number | null) =>
  ts ? new Date(ts * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : null;

export default function TheOrder({
  live = false,
  reapers = [],
  kept0 = {},
  rising = [],
}: {
  live?: boolean;
  reapers?: OrderEntry[];
  /// souls kept per reaper, read on the SERVER so the first paint already asks
  /// the compositor for the right art instead of a dry face it must replace
  kept0?: Record<number, number>;
  rising?: RisingEntry[];
}) {
  const [layerData, setLayerData] = useState<LayerData | null>(null);
  useEffect(() => {
    loadLayerData().then(setLayerData).catch(() => {});
  }, []);

  const ascended = live ? reapers : [];

  // The vaults of the Order — one ERC-6551 account per ascended reaper, read
  // straight from the diamond (the facet reverts for anything not ascended).
  const client = usePublicClient({ chainId: 1 });
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
        <OrderGrid list={ascended} layerData={layerData} vaults={vaults} kept0={kept0} />
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
                    <img src={IMG(r.id, 0, r.consumed)} alt={`Soul #${r.id}`} loading="lazy" />
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
  kept0,
}: {
  list: OrderEntry[];
  layerData: LayerData | null;
  vaults: Map<number, ReaperVault>;
  kept0: Record<number, number>;
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
                  src={IMG(r.id, vaults.get(r.id)?.kept ?? kept0[r.id] ?? 0, r.consumed)}
                  alt={`Soul Reaper #${r.id}`}
                  loading="lazy"
                />
              )}
            </div>
            <div className={styles.orderBody}>
              <div className={styles.orderName}>
                <span className={styles.orderMark}>🜃</span> Soul Reaper <b>#{r.id}</b>
              </div>
              {/* LA CIFRA GRANDE ES LA QUE SE MUEVE. Las 30 consumidas son
                  identicas en los dieciseis — es el precio de entrada, no un
                  logro, y de titular no decia nada. Lo que distingue a un
                  reaper hoy es lo que GUARDA, que va de 0 a 60 y ademas manda
                  sobre el arte. Asi que las almas guardadas van grandes y la
                  hoguera que lo creo queda de pie de foto. */}
              {(() => {
                const kept = vaults.get(r.id)?.kept ?? kept0[r.id] ?? 0;
                const { earth } = stagesFromKept(kept);
                return (
                  <div className={styles.orderHeld}>
                    <b className={earth > 0 ? styles.orderHeldGround : undefined}>{kept}</b>
                    <span className={styles.orderHeldUnit}>
                      soul{kept === 1 ? "" : "s"} held
                    </span>
                    <span className={styles.orderBurned}>
                      <span className="ico">🔥</span> {r.consumed} burned to raise it
                    </span>
                  </div>
                );
              })()}
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
                  title={
                    (vaults.get(r.id)?.ground ?? 0n) > 0n
                      ? `${fmtVaultEth(vaults.get(r.id)!.eth)} on Ethereum + ${fmtVaultEth(vaults.get(r.id)!.ground)} on Robinhood Chain — the same vault, one address on both. It travels with the reaper wherever it hangs.`
                      : `${ensNameOf(r.id)} is this reaper's vault — a real ENS name for an on-chain account bound to the token itself. Anyone can send to it, and it travels with the reaper wherever it hangs.`
                  }
                >
                  <span className={styles.orderVaultMark}>⚱</span> {ensNameOf(r.id)} ·{" "}
                  {/* The vault has the SAME address on Robinhood Chain, where the
                      ground dividend is paid, so what stands behind a reaper is
                      the SUM. Printing "A + B on RH" overflowed the chip and told
                      a buyer less than one number does; the split lives in the
                      tooltip, where it costs no room. */}
                  <span className={vaults.get(r.id)!.ground > 0n ? styles.orderVaultGround : undefined}>
                    {fmtVaultEth(vaults.get(r.id)!.eth + vaults.get(r.id)!.ground)}
                  </span>{" "}
                  ↗
                </a>
              ) : null}
              {/* EL TECHO. Quien envia desde OpenSea pegando el nombre no ve
                  ninguno de nuestros avisos, y un alma de mas alli no da ningun
                  boleto: se guarda y ya. Decirlo donde se copia el nombre es el
                  unico sitio donde llega a tiempo. */}
              {(() => {
                const kept = vaults.get(r.id)?.kept ?? 0;
                if (kept < BEHIND_CAP) return null;
                const { earth } = stagesFromKept(kept);
                // Once the ground has actually started, stop selling it and
                // report it: what it keeps, how much land it stands on, and what
                // the next piece costs.
                if (earth > 0) {
                  return (
                    <div
                      className={styles.orderFull}
                      title="The art reads this reaper's vault: one more earth piece every five souls, from thirty to sixty."
                    >
                      Ground <strong>{earth}/6</strong>
                      {kept >= GROUND_CAP
                        ? " — solid ground"
                        : ` — ${5 - ((kept - BEHIND_CAP) % 5)} more souls for the next piece`}
                    </div>
                  );
                }
                return (
                  <div
                    className={styles.orderFull}
                    title="A reaper counts at most 30 souls toward the draw — but the art keeps reading the vault to sixty."
                  >
                    Odds full at {BEHIND_CAP} — past here a soul buys no ticket, it buys{" "}
                    <strong>ground</strong>: one more earth piece every five, to {GROUND_CAP}
                  </div>
                );
              })()}
            </div>
          </article>
        );
      })}
    </div>
  );
}
