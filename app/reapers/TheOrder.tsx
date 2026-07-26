"use client";

import { useEffect, useMemo, useState } from "react";
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
// live=false → an elegant empty state + 2-3 clearly-marked preview reapers, so the
// section reads as intended before the fire is lit.

export type OrderEntry = { id: number; consumed: number; marks: number[]; holder: string };

const IMG = (id: number) => `https://cubistsouls.vercel.app/api/img?id=${id}`;
const SOULS_OS = "0x9252fdc0b3945203314ea1a9b8d64345bc868406";

// preview reapers (illustrative) — real art via the vector engine, fake consumption
const PREVIEW: OrderEntry[] = [
  { id: 136, consumed: 41, marks: [3, 1, 2], holder: "0x4943a1b0c7f2e5d9a8b3c4d5e6f70819a2b3c4d5" },
  { id: 777, consumed: 34, marks: [3, 1], holder: "0xc6d4e2f0a1b2c3d4e5f60718293a4b5c6d7e8f90" },
  { id: 42, consumed: 30, marks: [3], holder: "0xa41d3e2b1c0f9e8d7c6b5a4938271605f4e3d2c1" },
];

const short = (w: string) => (w && w.length >= 10 ? `${w.slice(0, 6)}…${w.slice(-4)}` : w || "—");

export default function TheOrder({ live = false, reapers = [] }: { live?: boolean; reapers?: OrderEntry[] }) {
  const [layerData, setLayerData] = useState<LayerData | null>(null);
  useEffect(() => {
    loadLayerData().then(setLayerData).catch(() => {});
  }, []);

  const isPreview = !live || reapers.length === 0;
  const list = useMemo(() => (isPreview ? PREVIEW : reapers), [isPreview, reapers]);

  // Preview (flag off, or live-but-no-reapers-yet): the elegant empty state +
  // 2-3 illustrative reapers, clearly tagged. The real leaderboard replaces this
  // the moment the first soul crosses thirty.
  if (isPreview) {
    return (
      <div className={styles.orderEmpty}>
        <span className={styles.orderScythe}>🜃</span>
        <p className={styles.orderEmptyLead}>No reapers yet.</p>
        <p className={styles.orderEmptySub}>
          Hit 30 burned and your Soul becomes a Reaper — right here. Preview below.
        </p>
        <OrderGrid list={PREVIEW} layerData={layerData} preview />
      </div>
    );
  }

  return <OrderGrid list={list} layerData={layerData} preview={false} />;
}

function OrderGrid({ list, layerData, preview }: { list: OrderEntry[]; layerData: LayerData | null; preview: boolean }) {
  return (
    <div className={styles.orderGrid}>
      {list.map((r, i) => {
        const stack = layerData ? composeStack(r.id, layerData, r.marks) : [];
        const marks = r.marks.map((m) => MARK_BY_ID.get(m)).filter(Boolean);
        return (
          <article className={styles.orderCard} key={`${r.id}-${i}`}>
            <div className="tryon-stack">
              <span className={styles.orderRank}>#{i + 1}</span>
              {preview && <span className={styles.orderPreviewTag}>preview</span>}
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
                href={preview ? undefined : `https://opensea.io/item/ethereum/${SOULS_OS}/${r.id}`}
                target={preview ? undefined : "_blank"}
                rel="noopener noreferrer"
                aria-disabled={preview}
                onClick={(e) => preview && e.preventDefault()}
              >
                held by {short(r.holder)}
              </a>
            </div>
          </article>
        );
      })}
    </div>
  );
}
