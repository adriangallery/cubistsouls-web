"use client";

import { useEffect, useState } from "react";
import {
  loadLayerData,
  composeStack,
  MARK_BY_ID,
  type LayerData,
} from "@/lib/reaper";
import styles from "./reapers.module.css";

// THE ORDER — the public leaderboard of Soul Reapers: every soul (any holder) that
// crossed 30 souls consumed and earned the rename. Data is derived from the
// ReaperAscended events server-side (getReapers, same pattern as The Freed) and
// handed down; the art is composed HERE with the vector engine so each reaper shows
// its marks (never a blend over the flat PNG).
//
// The prominent spot is RESERVED for real ascended reapers. No placeholders: while
// none have crossed 30 the section shows a single "awaits its first reaper" plate.
// Beneath it, RISING — real souls already burning canvases (0<consumed<30) but not
// yet renamed — appear as a compact, less-prominent row of aspirants.

export type OrderEntry = {
  id: number;
  consumed: number;
  marks: number[];
  holder: string;
  ascendedAt?: number | null;
};
export type RisingEntry = { id: number; consumed: number; marks: number[] };

const IMG = (id: number) => `/api/img?id=${id}`;
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

  return (
    <>
      {/* THE prominent spot — real ascended reapers, or the reserved plate. */}
      {ascended.length > 0 ? (
        <OrderGrid list={ascended} layerData={layerData} />
      ) : (
        <div className={styles.orderEmpty}>
          <span className={styles.orderScythe}>🜃</span>
          <p className={styles.orderEmptyLead}>The order awaits its first reaper.</p>
          <p className={styles.orderEmptySub}>
            Hit 30 burned and your Soul is renamed a Reaper — its place is here.
          </p>
        </div>
      )}

      {/* RISING — real aspirants already feeding the fire, compact + secondary. */}
      {rising.length > 0 && (
        <div className={styles.rising}>
          <div className={styles.risingHead}>
            <span className={styles.risingKick}>Rising</span>
            <span className={styles.risingSub}>burning now · not yet ascended</span>
          </div>
          <ul className={styles.risingList}>
            {rising.map((r) => {
              const pct = Math.min(100, (r.consumed / 30) * 100);
              const marks = r.marks.map((m) => MARK_BY_ID.get(m)).filter(Boolean);
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
                  {marks.length > 0 && (
                    <span className={styles.risingMarks}>
                      {marks.map((m) => m!.name).join(" · ")}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}

function OrderGrid({ list, layerData }: { list: OrderEntry[]; layerData: LayerData | null }) {
  return (
    <div className={styles.orderGrid}>
      {list.map((r, i) => {
        const stack = layerData ? composeStack(r.id, layerData, r.marks) : [];
        const marks = r.marks.map((m) => MARK_BY_ID.get(m)).filter(Boolean);
        return (
          <article className={styles.orderCard} key={`${r.id}-${i}`}>
            <div className="tryon-stack">
              <span className={styles.orderRank}>#{i + 1}</span>
              {stack.length ? (
                stack.map((src, j) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={`${src}-${j}`} className="lyr" src={src} alt="" loading="lazy" />
                ))
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="lyr" src={IMG(r.id)} alt={`Soul Reaper #${r.id}`} loading="lazy" />
              )}
            </div>
            <div className={styles.orderBody}>
              <div className={styles.orderName}>
                <span className={styles.orderMark}>🜃</span> Soul Reaper <b>#{r.id}</b>
              </div>
              <div className={styles.orderConsumed}>
                <span className="ico">🔥</span> Souls Consumed <b>{r.consumed}</b>
              </div>
              {marks.length > 0 && (
                <div className={styles.orderMarks}>
                  {marks.map((m) => (
                    <span className={styles.orderChip} key={m!.id}>{m!.name}</span>
                  ))}
                </div>
              )}
              <a
                className={styles.orderHolder}
                href={`https://opensea.io/item/ethereum/${SOULS_OS}/${r.id}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                held by {short(r.holder)}
              </a>
              {ascDate(r.ascendedAt) ? (
                <div className={styles.orderAscended}>Ascended {ascDate(r.ascendedAt)}</div>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}
