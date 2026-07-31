"use client";

import { blocksToHuman, earnableRules, settledRules, stageOf, type Raffle, type RaffleStage } from "@/lib/raffle";
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
  holderBlock: 0,
  closeBlock: 0,
  drawBlock: 0,
  seed: "0x",
  winners: 1,
  cancelled: false,
  ticketsHash: "0x",
  winnerList: [],
  w: { perConsumedSoul: 1, perAscendedReaper: 10, perHolderWallet: 1, perSoulHeld: 0, perOGSoulHeld: 0, maxPerWallet: 0 },
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
          Holding a soul earns you a seat. Feeding the fire earns you more, and keeps earning while
          an occasion is open. This is the room where they matter.
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
          An occasion stays open for days so that feeding the fire while it runs actually counts.
          That is why the tickets are counted at two different moments, not one.
        </p>
        <ol className={styles.steps}>
          <li>
            <span className={styles.stepK}>Holders were counted before the announcement</span>
            <span>
              The entry you get for simply holding a soul was settled at a block already mined when
              this was announced. It is the one thing that could be farmed by spreading a collection
              across new wallets — so the count had already happened.
            </span>
          </li>
          <li>
            <span className={styles.stepK}>The fire counts until the window shuts</span>
            <span>
              Every Pikkazo your reapers consume while the occasion is open earns its ticket, and a
              soul that reaches Soul Reaper earns more. These cannot be faked by splitting wallets:
              more tickets means more canvases actually burned.
            </span>
          </li>
          <li>
            <span className={styles.stepK}>The seed comes after the close</span>
            <span>
              The draw uses the hash of a block nobody has mined yet. The museum sets the dates but
              cannot know the seed — so it cannot arrange for a chosen wallet to win.
            </span>
          </li>
          <li>
            <span className={styles.stepK}>Then everyone can check</span>
            <span>
              The rules freeze the moment the seed lands — weights, exclusions and dates all become
              immutable. The ticket list is published with its hash written on-chain. Rebuild it,
              draw with the seed, and you get the same winner — or the museum is caught.
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
  open: { k: "Open", cls: "sOpen" },
  closed: { k: "Closed", cls: "sDraw" },
  "awaiting-draw": { k: "Drawing", cls: "sDraw" },
  drawn: { k: "Seed anchored", cls: "sDraw" },
  published: { k: "Drawn", cls: "sDone" },
  cancelled: { k: "Cancelled", cls: "sOff" },
};

function RaffleCard({ r, head, preview }: { r: Raffle; head: number; preview: boolean }) {
  const stage: RaffleStage = preview ? "open" : stageOf(r, head);
  const s = STAGE_COPY[stage];
  const earnable = earnableRules(r.w);
  const settled = settledRules(r.w);
  const left = r.closeBlock - head;

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
          {!preview && stage === "open" && left > 0 ? (
            <span className={styles.closes}>closes in {blocksToHuman(left)}</span>
          ) : null}
        </div>
        <h2 className={styles.cardTitle}>{r.label}</h2>

        {earnable.length ? (
          <div className={styles.rules}>
            <span className={styles.rulesK}>
              {stage === "open" ? "Still earnable — the fire is open" : "Earned while the window was open"}
            </span>
            <ul>
              {earnable.map((t: string) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {settled.length ? (
          <div className={`${styles.rules} ${styles.settled}`}>
            <span className={styles.rulesK}>Already settled</span>
            <ul>
              {settled.map((t: string) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <dl className={styles.blocks}>
          <div>
            <dt>Holders counted at</dt>
            <dd>{r.holderBlock ? fmt(r.holderBlock) : "—"}</dd>
          </div>
          <div>
            <dt>Burning counts until</dt>
            <dd>{r.closeBlock ? fmt(r.closeBlock) : "—"}</dd>
          </div>
          <div>
            <dt>Seed from block</dt>
            <dd>{r.drawBlock ? fmt(r.drawBlock) : "—"}</dd>
          </div>
        </dl>

        {stage === "published" ? (
          <div className={styles.winners}>
            <span className={styles.rulesK}>Won by</span>
            {r.winnerList.map((w: string) => (
              <a key={w} className={styles.winner} href={`/curator/${w}`}>
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
