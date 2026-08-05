"use client";

// THE DRAW — where half of every burn ends up.
//
// A burn sets aside half its fee for the Order and commits the draw to a block
// that has not happened yet; the next burn reads that block and pays a single
// member. Nothing here is scheduled and nobody runs it — it rides along with
// the collection's own traffic.
//
// The bars are the point: a reaper's odds next to everyone else's, and the part
// of that strength which came from the souls entrusted to it. That is the thing
// a holder can actually change.

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePublicClient } from "wagmi";
import { loadOrder, loadDraws, fmtEth, pct, type OrderState, type DrawRecord } from "@/lib/order";
import styles from "./thedraw.module.css";

// a member of the Order wears its marks: the composed art, never the plain
// canvas it was freed from
// Bump when the compositor's output changes: it retires every cached image in
// every browser at once. (Entries served during the flaky-read window were dry
// when they should have been drowned, and a browser has no way to know that.)
const ART_VERSION = "t2";
const IMG = (id: number, kept = 0) => `/api/reaper-img?id=${id}&kept=${kept}&v=${ART_VERSION}`;
const short = (w: string) => (w && w.length >= 10 ? `${w.slice(0, 6)}…${w.slice(-4)}` : w || "—");

export default function TheDraw() {
  const client = usePublicClient();
  const [order, setOrder] = useState<OrderState | null>(null);
  const [draws, setDraws] = useState<DrawRecord[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!client) return;
    let stale = false;
    loadOrder(client)
      .then((o) => !stale && (o ? setOrder(o) : setFailed(true)))
      .catch(() => !stale && setFailed(true));
    loadDraws(client)
      .then((d) => !stale && setDraws(d))
      .catch(() => !stale && setDraws([]));
    return () => {
      stale = true;
    };
  }, [client]);

  if (failed) {
    return <p className={styles.dim}>The draw could not be read just now — a reader hiccup, not an empty pot.</p>;
  }
  if (!order) return <p className={styles.dim}>Reading the draw…</p>;

  const best = order.members[0]?.weight ?? 1;

  return (
    <div className={styles.wrap}>
      {/* the rule, in one line, and what is currently waiting */}
      <div className={styles.head}>
        <div className={styles.rule}>
          <span className={styles.ruleMark}>🜃</span>
          Every burn splits its fee: <b>half stays with the museum</b>, <b>half goes to one reaper</b>,
          drawn on chain. The next burn pays it.
        </div>
        <div className={styles.pot}>
          <span className={styles.potLabel}>Waiting for the next burn</span>
          <b className={styles.potValue}>{fmtEth(order.pot)}</b>
        </div>
      </div>

      {/* the comparison — odds, and how much of them was earned with souls */}
      <div className={styles.bars} role="list" aria-label="The Order's odds">
        {order.members.map((m) => {
          const width = (m.weight / best) * 100;
          const basePart = (order.base / m.weight) * 100;
          return (
            <div className={styles.row} key={m.id} role="listitem">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className={styles.face} src={IMG(m.id, m.kept)} alt={`Soul Reaper #${m.id}`} loading="lazy" />
              <Link className={styles.id} href={`/reapers#${m.id}`}>
                #{m.id}
              </Link>
              <span className={styles.bar} title={`${m.weight} tickets of ${order.totalWeight}`}>
                <span className={styles.barFill} style={{ width: `${width}%` }}>
                  <span className={styles.barBase} style={{ width: `${basePart}%` }} />
                </span>
              </span>
              <span className={styles.odds}>{pct(m.share)}</span>
              <span className={styles.kept}>
                {m.kept > 0 ? (
                  <>
                    +{m.kept} soul{m.kept === 1 ? "" : "s"}
                    {m.kept >= order.bonusCap ? " · full" : ""}
                  </>
                ) : (
                  <span className={styles.keptNone}>no souls kept</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
      <p className={styles.legend}>
        The solid part of each bar is what a reaper carries simply for being one ({order.base}). The rest is
        the souls entrusted to it — one ticket each, up to {order.bonusCap}. Souls tilt the draw; they cannot
        buy it.
      </p>

      {/* the ledger — every draw ever settled, straight from the chain */}
      <div className={styles.ledger}>
        <div className={styles.ledgerHead}>
          <span className={styles.ledgerTitle}>The ledger</span>
          <span className={styles.ledgerSub}>every draw ever settled · verifiable on chain</span>
        </div>
        {draws === null ? (
          <p className={styles.dim}>Reading the ledger…</p>
        ) : draws.length === 0 ? (
          <p className={styles.dim}>No draw has been settled yet. The first burn to follow a burn will do it.</p>
        ) : (
          <ul className={styles.ledgerList}>
            {draws.map((d) => (
              <li className={styles.ledgerRow} key={d.txHash}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className={styles.ledgerFace} src={IMG(d.reaperId)} alt="" loading="lazy" />
                <span className={styles.ledgerId}>#{d.reaperId}</span>
                <span className={styles.ledgerAmount}>{fmtEth(d.amount)}</span>
                <span className={styles.ledgerOdds}>
                  won at {pct(d.weight / d.totalWeight)}
                </span>
                <a
                  className={styles.ledgerLink}
                  href={`https://etherscan.io/tx/${d.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {short(d.txHash)} ↗
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
