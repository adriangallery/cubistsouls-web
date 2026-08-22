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
import { ASCEND_AT, GROUND_CAP } from "@/lib/reaper";
import styles from "./thedraw.module.css";

// a member of the Order wears its marks: the composed art, never the plain
// canvas it was freed from
// Bump when the compositor's output changes: it retires every cached image in
// every browser at once. (Entries served during the flaky-read window were dry
// when they should have been drowned, and a browser has no way to know that.)
// t3 (6-ago): retira las entradas que quedaron envenenadas cuando el mini iba
// ahogado — dos reapers salian rotos en el navegador aunque el servidor los
// servia bien. Con el cache largo de /api/reaper-img esto ya no deberia repetirse.
const ART_VERSION = "e1"; // the ground: reapers past thirty kept souls repaint
// Being on the roster IS being ascended, so consumed is at least ASCEND_AT and
// every milestone mark is lit. Saying so in the URL means the compositor never
// has to ask a node — which is what stopped these thumbnails falling back to the
// plain canvas whenever a public gateway throttled the page.
const IMG = (id: number, kept = 0, consumed = ASCEND_AT) =>
  `/api/reaper-img?id=${id}&kept=${kept}&c=${consumed}&w=384&v=${ART_VERSION}`;
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

      {/* The comparison — odds, and how much of them was earned with souls.
          ⚠️ The scale is ABSOLUTE (base + 60), not relative to the strongest.
          It used to be relative, which was fine while thirty was the end of the
          world: every full reaper filled the row and the bar said "done". Now a
          vault runs to sixty and the second thirty buys something else, so the
          row has to show the headroom — and the tone has to change at the
          ticket cap, because past it the souls stop moving these odds. */}
      <div className={styles.bars} role="list" aria-label="The Order's odds">
        {order.members.map((m) => {
          const scale = order.base + GROUND_CAP;
          const basePart = (order.base / scale) * 100;
          const ticketPart = (Math.min(m.ticketed, order.bonusCap) / scale) * 100;
          const groundSouls = Math.max(0, Math.min(m.kept, GROUND_CAP) - order.bonusCap);
          const groundPart = (groundSouls / scale) * 100;
          const capMark = ((order.base + order.bonusCap) / scale) * 100;
          return (
            <div className={styles.row} key={m.id} role="listitem">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className={styles.face} src={IMG(m.id, m.kept)} alt={`Soul Reaper #${m.id}`} loading="lazy" />
              <Link className={styles.id} href={`/reapers#${m.id}`}>
                #{m.id}
              </Link>
              <span
                className={styles.bar}
                title={`${m.weight} tickets of ${order.totalWeight}${
                  groundSouls > 0 ? ` · ${groundSouls} more souls kept, which buy ground, not odds` : ""
                }`}
              >
                <span className={styles.barBase} style={{ width: `${basePart}%` }} />
                <span className={styles.barTickets} style={{ width: `${ticketPart}%` }} />
                <span className={styles.barGround} style={{ width: `${groundPart}%` }} />
                <i className={styles.barCap} style={{ left: `${capMark}%` }} aria-hidden="true" />
              </span>
              <span className={styles.odds}>{pct(m.share)}</span>
              <span className={styles.kept}>
                {m.kept > 0 ? (
                  <>
                    +{m.ticketed} ticket{m.ticketed === 1 ? "" : "s"}
                    {m.ticketed >= order.bonusCap ? " · full" : ""}
                    {/* Past the cap the tickets stop but the vault does not, and
                        the vault is what the art reads — so say the real number
                        instead of letting it look like a reaper stuck at thirty. */}
                    {m.kept > order.bonusCap ? (
                      <>
                        {" · "}
                        <span className={styles.keptGround}>{m.kept} souls kept</span>
                      </>
                    ) : null}
                  </>
                ) : (
                  <span className={styles.keptNone}>no souls kept</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
      <div className={styles.key} aria-hidden="true">
        <span className={styles.keyItem}><i className={styles.keyBase} />being a reaper ({order.base})</span>
        <span className={styles.keyItem}><i className={styles.keyTickets} />souls that buy tickets (to {order.bonusCap})</span>
        <span className={styles.keyItem}><i className={styles.keyGround} />souls that buy ground ({order.bonusCap}–{GROUND_CAP})</span>
      </div>
      <p className={styles.legend}>
        The solid part of each bar is what a reaper carries simply for being one ({order.base}). The rest is
        the souls entrusted to it — one ticket each, up to {order.bonusCap}. Souls tilt the draw; they cannot
        buy it. Past {order.bonusCap} a soul stops buying tickets and starts raising ground: the art keeps
        reading the vault all the way to {GROUND_CAP}, and what a fully earthed reaper is owed beyond that is
        being written now.
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
