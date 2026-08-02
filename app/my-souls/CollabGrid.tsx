"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSignMessage } from "wagmi";
import SoulCard from "../components/SoulCard";
import { TransferModal, useBatchTransferLive, useCanTransfer } from "./TransferFlow";
import type { MHExhibit } from "@/lib/mh";
import {
  collabMessage,
  collabStatus,
  collabGenerate,
  cacheSet,
  WTP_HOME,
  type CollabStatus,
} from "@/lib/collab";

const IMG = (id: number) => `/api/img?id=${id}`;
const SPARK = (
  <svg className="spark" viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
    <path d="M12 2l2.3 7.7L22 12l-7.7 2.3L12 22l-2.3-7.7L2 12l7.7-2.3z" />
  </svg>
);

function toast(msg: string, ms = 6000) {
  document.querySelectorAll(".toast").forEach((t) => t.remove());
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  if (ms) setTimeout(() => t.remove(), ms);
}

type FiredMap = Record<number, CollabStatus>;
type Modal =
  | { kind: "intro"; id: number }
  | { kind: "oven"; id: number }
  | { kind: "result"; id: number; imageUrl?: string; postUrl?: string; note?: string }
  | { kind: "error"; id: number; msg: string }
  | null;

type Sort = "id" | "rate" | "rarity";

// Every owned soul: OpenSea link stays (these are the holder's OWN souls — Adrian
// 25-jul), plus the WTP "Fire is fine" spark. `collab` flag gates the spark; when
// off (or WTP unreachable) the grid is just OpenSea-linked soul cards.
//
// The card is now ALSO the museum cartela: rate/h, cohort seal, rarity seal and
// rank ride on it (`exhibits`), so the old duplicate "exhibits" grid stays gone
// but its data doesn't (Adrian, 25-jul). Sorting works off the same data.
// First reaper mark (Orange) unlocks at 6 consumed — at/above this a soul has
// composed art (marks) worth showing in the grid; below it /api/reaper-img would
// just 307 back to the flat art, so we don't pay that redirect for the other souls.
const REAPER_ART_MIN = 6;
// Absolute prod endpoint (Adrian 26-jul): composes the soul with its milestone
// marks server-side; s-maxage 300.
const REAPER_IMG = (id: number) => `https://cubistsouls.com/api/reaper-img?id=${id}`;

export default function CollabGrid({
  owned,
  address,
  collabEnabled,
  exhibits,
  consumedById,
  canTransfer = false,
  onTransferred,
}: {
  owned: number[];
  address: string;
  collabEnabled: boolean;
  exhibits?: MHExhibit[] | null;
  // per-soul souls-consumed (from the page's ReaperState). Souls with marks
  // (consumed ≥ 6) render composed art in the grid.
  consumedById?: Map<number, number>;
  // The batch-send tool (mode "self" only). It renders only once the Diamond
  // routes batchTransfer on mainnet AND the connected signer is this wallet.
  canTransfer?: boolean;
  onTransferred?: () => void;
}) {
  const { signMessageAsync } = useSignMessage();
  const [fired, setFired] = useState<FiredMap>({});
  const [modal, setModal] = useState<Modal>(null);
  const [signing, setSigning] = useState(false);
  const [sort, setSort] = useState<Sort>("id");

  // ── the transfer tool (select mode) ──
  const batchLive = useBatchTransferLive();
  const signerHere = useCanTransfer(address);
  const transferable = canTransfer && batchLive && signerHere;
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [sendOpen, setSendOpen] = useState(false);

  const toggleSel = useCallback((id: number) => {
    setSel((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);
  const exitSelect = useCallback(() => {
    setSelecting(false);
    setSel(new Set());
    setSendOpen(false);
  }, []);
  const onSent = useCallback(() => {
    exitSelect();
    onTransferred?.();
  }, [exitSelect, onTransferred]);

  const stats = useMemo(() => {
    const m = new Map<number, MHExhibit>();
    (exhibits || []).forEach((e) => m.set(e.id, e));
    return m;
  }, [exhibits]);

  const hasRates = stats.size > 0;
  const hasRarity = useMemo(() => (exhibits || []).some((e) => e.rank != null), [exhibits]);

  const ordered = useMemo(() => {
    const list = owned.slice();
    if (sort === "rate" && hasRates) {
      return list.sort((a, b) => (stats.get(b)?.rate ?? 0) - (stats.get(a)?.rate ?? 0) || a - b);
    }
    if (sort === "rarity" && hasRarity) {
      const rank = (id: number) => stats.get(id)?.rank ?? Number.MAX_SAFE_INTEGER;
      return list.sort((a, b) => rank(a) - rank(b) || a - b);
    }
    return list.sort((a, b) => a - b);
  }, [owned, sort, stats, hasRates, hasRarity]);

  // Lazy status hydration for the visible owned souls. Silent on failure (CORS /
  // endpoint warming up) — the default "create" spark stays.
  useEffect(() => {
    if (!collabEnabled || !owned.length) return;
    let cancelled = false;
    const list = owned.slice();
    let i = 0;
    const worker = async () => {
      while (i < list.length) {
        const id = list[i++];
        try {
          const st = await collabStatus(id);
          if (!cancelled && st?.used) setFired((f) => ({ ...f, [id]: st }));
        } catch { /* leave default */ }
      }
    };
    Promise.all(Array.from({ length: Math.min(4, list.length) }, worker)).catch(() => {});
    return () => { cancelled = true; };
  }, [owned, collabEnabled]);

  const openIntro = useCallback((id: number) => {
    const st = fired[id];
    if (st?.imageUrl) {
      setModal({ kind: "result", id, imageUrl: st.imageUrl, postUrl: st.postUrl, note: "This soul already has its WTP! artwork." });
    } else {
      setModal({ kind: "intro", id });
    }
  }, [fired]);

  const doFire = useCallback(
    async (id: number) => {
      if (!address) { toast("Connect your wallet first."); return; }
      setSigning(true);
      let sig: string;
      try {
        sig = await signMessageAsync({ message: collabMessage(id, address) });
      } catch {
        setSigning(false);
        toast("Signature declined — nothing was fired.");
        return;
      }
      setModal({ kind: "oven", id });
      try {
        const r = await collabGenerate(id, address, sig);
        if (r.ok) {
          const st: CollabStatus = { used: true, imageUrl: r.imageUrl, postUrl: r.postUrl };
          cacheSet(id, st);
          setFired((f) => ({ ...f, [id]: st }));
          setModal({ kind: "result", id, imageUrl: r.imageUrl, postUrl: r.postUrl });
        } else if (r.status === 409) {
          const st: CollabStatus = { used: true, imageUrl: r.imageUrl, postUrl: r.postUrl };
          cacheSet(id, st);
          setFired((f) => ({ ...f, [id]: st }));
          if (r.imageUrl) setModal({ kind: "result", id, imageUrl: r.imageUrl, postUrl: r.postUrl, note: "This soul already has its WTP! artwork." });
          else setModal({ kind: "error", id, msg: "This soul has already been fired." });
        } else if (r.status === 429) {
          setModal({ kind: "error", id, msg: "The fire is busy right now — try again in a moment." });
        } else {
          // 0/403/404/503 etc — includes the CORS-blocked case on the preview URL
          setModal({ kind: "error", id, msg: "The collab is warming up — try again soon." });
        }
      } catch {
        setModal({ kind: "error", id, msg: "The collab is warming up — try again soon." });
      } finally {
        setSigning(false);
      }
    },
    [address, signMessageAsync],
  );

  const close = useCallback(() => setModal(null), []);
  useEffect(() => {
    if (!modal) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [modal, close]);

  return (
    <>
      <div className="grid-tools">
        <div className="sortset" role="group" aria-label="Sort your souls">
          <span className="lbl">Sort</span>
          <button className={sort === "id" ? "on" : ""} onClick={() => setSort("id")}>
            № Number
          </button>
          <button
            className={sort === "rate" ? "on" : ""}
            onClick={() => setSort("rate")}
            disabled={!hasRates}
            title={hasRates ? "Highest Museum Hours rate first" : "Counting the museum's hours…"}
          >
            MH / hour
          </button>
          <button
            className={sort === "rarity" ? "on" : ""}
            onClick={() => setSort("rarity")}
            disabled={!hasRarity}
            title={hasRarity ? "Rarest first" : "The museum's rarity ledger is unavailable"}
          >
            Rarity
          </button>
        </div>

        {transferable && !selecting ? (
          <button
            className="tf-enter"
            title="Send several souls to another wallet in one transaction"
            onClick={() => setSelecting(true)}
          >
            ⇄ Transfer
          </button>
        ) : null}

        {collabEnabled && !selecting && (
          <details className="cx-strip">
            <summary>
              {SPARK} One free WTP! artwork per soul — tap the spark
            </summary>
            <p>
              WTP! paints a brand-new artwork from your soul with the prompt “Fire is fine”. Your Soul itself is never
              touched, burned or moved — this only creates an image. Made with WTP! technology · one free creation per
              soul.
            </p>
          </details>
        )}
      </div>

      <div className="grid ms-grid">
        {ordered.map((id) => {
          const st = fired[id];
          const ex = stats.get(id);
          const marked = (consumedById?.get(id) ?? 0) >= REAPER_ART_MIN;
          return (
            <div className={`soul-cell${selecting && sel.has(id) ? " picked" : ""}`} key={id}>
              <SoulCard
                id={id}
                status="Held"
                link={selecting ? "none" : "opensea"}
                stamp={false}
                imgSrc={marked ? REAPER_IMG(id) : undefined}
                stats={
                  ex
                    ? {
                        rate: ex.rate,
                        cohortName: ex.cohortName,
                        raritySeal: ex.raritySeal,
                        rankTxt: ex.rankTxt,
                      }
                    : undefined
                }
              />
              {collabEnabled && !selecting && (
                <button
                  className={`fire-btn${st?.used ? " fired" : ""}`}
                  title="Create this soul's free WTP! artwork — your NFT is not affected"
                  onClick={() => openIntro(id)}
                >
                  {SPARK} {st?.used ? "created" : ""}
                </button>
              )}
              {selecting && (
                <button
                  className="tf-pick"
                  aria-pressed={sel.has(id)}
                  aria-label={`${sel.has(id) ? "Deselect" : "Select"} soul ${id}`}
                  onClick={() => toggleSel(id)}
                >
                  <span className="tf-tick">{sel.has(id) ? "✓" : ""}</span>
                </button>
              )}
            </div>
          );
        })}
      </div>

      {selecting && (
        <div className="tf-bar" role="toolbar" aria-label="Transfer souls">
          <span className="tf-count">
            <b>{sel.size}</b> of {owned.length} selected
          </span>
          <div className="tf-bar-btns">
            <button className="ghost" onClick={() => setSel(new Set(sel.size === owned.length ? [] : owned))}>
              {sel.size === owned.length ? "Clear" : "Select all"}
            </button>
            <button className="ghost" onClick={exitSelect}>Cancel</button>
            <button className="go" disabled={sel.size === 0} onClick={() => setSendOpen(true)}>
              Send {sel.size || ""} →
            </button>
          </div>
        </div>
      )}

      {sendOpen && sel.size > 0 && (
        <TransferModal
          ids={[...sel].sort((a, b) => a - b)}
          holder={address}
          onClose={() => setSendOpen(false)}
          onDone={onSent}
        />
      )}

      {modal && <FireModal modal={modal} signing={signing} onClose={close} onFire={doFire} onRetry={openIntro} />}
    </>
  );
}

function FireModal({
  modal,
  signing,
  onClose,
  onFire,
  onRetry,
}: {
  modal: NonNullable<Modal>;
  signing: boolean;
  onClose: () => void;
  onFire: (id: number) => void;
  onRetry: (id: number) => void;
}) {
  const id = modal.id;
  return (
    <div className="cx-modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cx-card" role="dialog" aria-modal="true">
        <button className="cx-close" aria-label="Close" onClick={onClose}>×</button>

        {modal.kind === "intro" && (
          <>
            <div className="cx-eyebrow">Cubist Souls × WTP!</div>
            <div className="cx-title">Reimagine Soul #{id}</div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="cx-img" src={IMG(id)} alt={`Cubist Soul #${id}`} />
            <div className="cx-copy">
              WTP! will paint a new artwork from this soul with the prompt <b>“Fire is fine”</b>.
              <br />Your Soul stays in your wallet, untouched — one free creation per soul.
            </div>
            <button className="cx-fire" disabled={signing} onClick={() => onFire(id)}>
              {SPARK} {signing ? "Check your wallet…" : "Sign & create"}
            </button>
          </>
        )}

        {modal.kind === "oven" && (
          <>
            <div className="cx-eyebrow">Cubist Souls × WTP!</div>
            <div className="cx-oven">
              <div className="flames">{SPARK} {SPARK} {SPARK}</div>
              The museum&apos;s studio is at work…
              <br />painting a new artwork from your soul.
            </div>
          </>
        )}

        {modal.kind === "result" && (
          <>
            <div className="cx-eyebrow">Fresh out of the fire</div>
            <div className="cx-title">Soul #{id} · “Fire is fine”</div>
            {modal.note ? <div className="cx-copy">{modal.note}</div> : null}
            {modal.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="cx-img" style={{ maxWidth: 420 }} src={modal.imageUrl} alt={`WTP generation for Cubist Soul #${id}`} />
            ) : null}
            <div className="cx-actions">
              <a className="primary" href={modal.postUrl || WTP_HOME} target="_blank" rel="noopener noreferrer">See it on WTP →</a>
            </div>
            <div className="cx-pitch">
              <p><b>This came out of WTP</b> — the prompt playground. Your soul is already on the feed.</p>
              <div className="row">
                <a className="gold" href={modal.postUrl || WTP_HOME} target="_blank" rel="noopener noreferrer">Explore WTP →</a>
                <a className="join" href={WTP_HOME} target="_blank" rel="noopener noreferrer">Join free</a>
              </div>
            </div>
          </>
        )}

        {modal.kind === "error" && (
          <>
            <div className="cx-eyebrow">Cubist Souls × WTP!</div>
            <div className="cx-title">Soul #{id}</div>
            <div className="cx-copy" style={{ fontSize: 14, color: "#f0c8a8" }}>{modal.msg}</div>
            <button className="cx-fire" onClick={() => onRetry(id)}>↻ Try again</button>
          </>
        )}
      </div>
    </div>
  );
}
