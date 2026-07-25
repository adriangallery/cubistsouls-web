"use client";

import { useCallback, useEffect, useState } from "react";
import { useSignMessage } from "wagmi";
import SoulCard from "../components/SoulCard";
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

// Every owned soul: OpenSea link stays (these are the holder's OWN souls — Adrian
// 25-jul), plus the WTP "Fire is fine" spark. `collab` flag gates the spark; when
// off (or WTP unreachable) the grid is just OpenSea-linked soul cards.
export default function CollabGrid({
  owned,
  address,
  collabEnabled,
}: {
  owned: number[];
  address: string;
  collabEnabled: boolean;
}) {
  const { signMessageAsync } = useSignMessage();
  const [fired, setFired] = useState<FiredMap>({});
  const [modal, setModal] = useState<Modal>(null);
  const [signing, setSigning] = useState(false);

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
      {collabEnabled && (
        <div className="collab-plaque">
          <div className="cx-h">{SPARK} Cubist Souls × WTP! — every soul gets one free “Fire is fine”</div>
          <div className="cx-p">
            Tap the spark on a soul and WTP! paints a brand-new artwork from it. Your Soul itself is never touched,
            burned or moved — this only creates an image. Made with WTP! technology · one free creation per soul.
          </div>
        </div>
      )}

      <div className="grid ms-grid">
        {owned.map((id) => {
          const st = fired[id];
          return (
            <div className="soul-cell" key={id}>
              <SoulCard id={id} status="Held" link="opensea" stamp={false} />
              {collabEnabled && (
                <button
                  className={`fire-btn${st?.used ? " fired" : ""}`}
                  title="Create this soul's free WTP! artwork — your NFT is not affected"
                  onClick={() => openIntro(id)}
                >
                  {SPARK} {st?.used ? "created" : ""}
                </button>
              )}
            </div>
          );
        })}
      </div>

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
