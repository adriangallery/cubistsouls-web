import type { ConsumedData } from "@/lib/chain";
import styles from "./reapers.module.css";

// THE CONSUMED — the memorial of canvases the fire has eaten. A big on-chain
// counter (Σ soulsConsumed, the truth — not an event count) sits above a grid of
// the fallen canvases, each rendered in "ash" (grey, veiled) and tagged with the
// reaper it fed. Data is derived from chain server-side (getConsumed, ISR) and
// handed down. Native lazy-loading on the art; long histories collapse to the
// most recent ~24 with an "and N more" line. Server component — no client JS.

const IMG = (id: number) => `https://cubistsouls.vercel.app/api/img?id=${id}`;
const MAX = 24;

export default function TheConsumed({ data }: { data: ConsumedData }) {
  const { total, canvases } = data;

  if (total <= 0 || canvases.length === 0) {
    return (
      <div className={styles.consumedEmpty}>
        <span className={styles.consumedScythe}>🜃</span>
        <p className={styles.consumedEmptyLead}>The fire waits.</p>
        <p className={styles.consumedEmptySub}>No souls consumed yet. The first offering lights it.</p>
      </div>
    );
  }

  const shown = canvases.slice(0, MAX);
  const more = canvases.length - shown.length;

  return (
    <>
      {/* the counter — a lapidary plaque, the number is the protagonist */}
      <div className={styles.consumedPlaque}>
        <span className={styles.consumedNum}>{total.toLocaleString("en-US")}</span>
        <span className={styles.consumedCap}>souls consumed by the order</span>
      </div>

      {/* the fallen canvases, in ash */}
      <div className={styles.consumedGrid}>
        {shown.map((c) => (
          <figure className={styles.ashCard} key={c.id}>
            <div className={styles.ashArt}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={IMG(c.id)} alt={`Consumed canvas №${c.id}`} loading="lazy" />
              <span className={styles.ashVeil} aria-hidden="true" />
            </div>
            <figcaption className={styles.ashMeta}>
              <span className={styles.ashId}>№{c.id}</span>
              <span className={styles.ashFed}>fed to <b>#{c.reaperId}</b></span>
            </figcaption>
          </figure>
        ))}
      </div>

      {more > 0 && (
        <p className={styles.consumedMore}>and {more.toLocaleString("en-US")} more into the ash</p>
      )}
    </>
  );
}
