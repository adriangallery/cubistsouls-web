"use client";

import { describeWeights, stageOf, type Raffle, type RaffleStage } from "@/lib/raffle";
import styles from "./raffles.module.css";

const fmt = (n: number) => n.toLocaleString("en-US");
const IMG = (id: number) => `/api/img?id=${id}`;

// The first occasion, as it will be set on-chain. Rendered as a PREVIEW until the
// facet is cut — same component, same copy, so what Adrian approves here is what
// ships. Soul #8777 stands in for the artwork; the real 1/1 replaces it later.
const PREVIEW: Raffle = {
  id: 0,
  label: "The first 1/1",
  prizeURI: IMG(8777),
  snapshotBlock: 0,
  drawBlock: 0,
  seed: "0x",
  winners: 1,
  cancelled: false,
  ticketsHash: "0x",
  winnerList: [],
  w: { perConsumedSoul: 1, perHolderWallet: 1, perSoulHeld: 0, perOGSoulHeld: 0, maxPerWallet: 0 },
};

export default function RafflesClient({
  data,
}: {
  data: { raffles: Raffle[]; head: number } | null;
}) {
  const preview = !data || data.raffles.length === 0;
  const raffles = preview ? [PREVIEW] : data!.raffles;
  const head = data?.head ?? 0;

  return (
    <main className={styles.wrap}>
      <header className={styles.hero}>
        <span className={styles.kicker}>🎟 Where the tickets are spent</span>
        <h1 className={styles.title}>THE RAFFLES</h1>
        <p className={styles.lead}>
          Every Pikkazo your reapers gave to the fire earned a ticket. Every soul you hold earns you
          a seat. This is the room where they matter.
        </p>
      </header>

      {preview ? (
        <p className={styles.previewNote}>
          <b>Preview</b> — no occasion is armed on-chain yet. This is how the first one will read.
        </p>
      ) : null}

      {raffles.map((r) => (
        <RaffleCard key={r.id} r={r} head={head} preview={preview} />
      ))}

      <section className={styles.how}>
        <h2 className={styles.h2}>How a draw is kept honest</h2>
        <p className={styles.howLead}>
          Two blocks decide everything, and they guard against two different kinds of cheating.
        </p>
        <ol className={styles.steps}>
          <li>
            <span className={styles.stepK}>The snapshot is already past</span>
            <span>
              Tickets are counted at a block that was mined before the occasion was announced. Nobody
              can spread a collection across new wallets to farm extra entries, because the count
              already happened.
            </span>
          </li>
          <li>
            <span className={styles.stepK}>The seed is still future</span>
            <span>
              The draw uses the hash of a block that has not been mined yet. The museum picks the
              snapshot but cannot know the seed — so it cannot pick a snapshot that makes a chosen
              wallet win.
            </span>
          </li>
          <li>
            <span className={styles.stepK}>Then everyone can check</span>
            <span>
              The rules freeze the moment the seed lands. The ticket list is published with its hash
              written on-chain. Rebuild the list from the snapshot, draw with the seed, and you get
              the same winner — or the museum is caught.
            </span>
          </li>
        </ol>
        <p className={styles.howFoot}>
          The museum&apos;s own wallets never enter. The exclusion list lives on the diamond and can
          be read by anyone.
        </p>
      </section>
    </main>
  );
}

const STAGE_COPY: Record<RaffleStage, { k: string; cls: string }> = {
  armed: { k: "Open", cls: "sOpen" },
  "awaiting-draw": { k: "Drawing", cls: "sDraw" },
  drawn: { k: "Seed anchored", cls: "sDraw" },
  published: { k: "Drawn", cls: "sDone" },
  cancelled: { k: "Cancelled", cls: "sOff" },
};

function RaffleCard({ r, head, preview }: { r: Raffle; head: number; preview: boolean }) {
  const stage = preview ? "armed" : stageOf(r, head);
  const s = STAGE_COPY[stage];
  const rules = describeWeights(r.w);
  const toDraw = r.drawBlock - head;

  return (
    <article className={styles.card}>
      <div className={styles.art}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={r.prizeURI || IMG(8777)} alt={r.label} loading="lazy" />
        {preview ? <span className={styles.placeholder}>placeholder artwork</span> : null}
      </div>

      <div className={styles.body}>
        <div className={styles.top}>
          <span className={`${styles.stage} ${styles[s.cls]}`}>{s.k}</span>
          <span className={styles.count}>
            {r.winners} winner{r.winners === 1 ? "" : "s"}
          </span>
        </div>
        <h2 className={styles.cardTitle}>{r.label}</h2>

        <div className={styles.rules}>
          <span className={styles.rulesK}>Your entries</span>
          <ul>
            {rules.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>

        <dl className={styles.blocks}>
          <div>
            <dt>Counted at block</dt>
            <dd>{r.snapshotBlock ? fmt(r.snapshotBlock) : "—"}</dd>
          </div>
          <div>
            <dt>Drawn from block</dt>
            <dd>
              {r.drawBlock ? fmt(r.drawBlock) : "—"}
              {!preview && stage === "armed" && toDraw > 0 ? (
                <span className={styles.until}> · in {fmt(toDraw)} blocks</span>
              ) : null}
            </dd>
          </div>
        </dl>

        {stage === "published" ? (
          <div className={styles.winners}>
            <span className={styles.rulesK}>Won by</span>
            {r.winnerList.map((w) => (
              <a
                key={w}
                className={styles.winner}
                href={`/curator/${w}`}
              >
                {w.slice(0, 6)}…{w.slice(-4)}
              </a>
            ))}
          </div>
        ) : null}

        <p className={styles.foot}>
          {preview
            ? "Rules and blocks are set on-chain when the occasion opens."
            : "Rules, seed and result all live on the diamond — this page only reads them."}
        </p>
      </div>
    </article>
  );
}
