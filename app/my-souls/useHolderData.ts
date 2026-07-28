"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePublicClient } from "wagmi";
import { loadSouls, tierOf, type SoulsData } from "@/lib/souls";
import { buildMyMH, boardForAccount, type MyMHResult, type MHBoardResult, type BoardData } from "@/lib/mh";
import { getReaperState, type ReaperState } from "@/lib/reaper";
import { mineFrom, type MineEntry } from "./MyReapers";
import flags from "@/public/flags.json";

const REAPER_LIVE = (flags as { reaperLive?: boolean }).reaperLive === true;

export type HolderPhase = "idle" | "loading" | "loaded" | "error";

// The full per-holder read-out — the SINGLE source for both /my-souls (self, with
// actions) and /curator/<address> (public, read-only). Extracted verbatim from the
// old MySouls.load() so the two views never drift: same RPC scan, same two-phase MH,
// same derived plaque figures. The only per-view difference is what the UI wraps
// around this data (share/collab actions on self; identity header on public).
export type HolderData = {
  phase: HolderPhase;
  data: SoulsData | null;
  reaper: Map<number, ReaperState> | null;
  myMh: MyMHResult | null;
  mhPhase: HolderPhase;
  board: MHBoardResult | null;
  boardPhase: HolderPhase;
  boardUpdatedAt: number | null;
  // derived (identical math to the old MySouls body)
  mine: MineEntry[];
  consumed: number;
  contribution: number;
  deckRank: number;
  deckTotal: number;
  tier: string;
  reaperLive: boolean;
};

/**
 * Load everything about one wallet, client-side, exactly like my-souls did:
 *  1. the Curators' board (server-cached, account-agnostic) — fired IMMEDIATELY, in
 *     parallel with the soul scan, then sliced to this wallet's row;
 *  2. loadSouls (freed / rank / owned / acquisition blocks);
 *  3. per-owned reaper state (consumed / marks) when the facet is live;
 *  4. the CHEAP Museum-Hours pass (your hours, seconds).
 *
 * `enabled` gates the whole thing (my-souls: connected && address; curator: a valid
 * resolved address). When disabled the hook resets to idle.
 */
export function useHolderData(account: string | undefined, enabled = true): HolderData {
  const client = usePublicClient();

  const [phase, setPhase] = useState<HolderPhase>("idle");
  const [data, setData] = useState<SoulsData | null>(null);
  const [reaper, setReaper] = useState<Map<number, ReaperState> | null>(null);
  const [myMh, setMyMh] = useState<MyMHResult | null>(null);
  const [mhPhase, setMhPhase] = useState<HolderPhase>("idle");
  const [board, setBoard] = useState<MHBoardResult | null>(null);
  const [boardPhase, setBoardPhase] = useState<HolderPhase>("idle");
  const [boardUpdatedAt, setBoardUpdatedAt] = useState<number | null>(null);
  const reqRef = useRef(0); // guards against stale async when the address changes

  const reset = useCallback(() => {
    reqRef.current++;
    setPhase("idle");
    setData(null);
    setReaper(null);
    setMyMh(null);
    setBoard(null);
    setBoardUpdatedAt(null);
    setMhPhase("idle");
    setBoardPhase("idle");
  }, []);

  const load = useCallback(
    async (acct: string) => {
      if (!client) return;
      const reqId = ++reqRef.current;
      setPhase("loading");
      setData(null);
      setReaper(null);
      setMyMh(null);
      setBoard(null);
      setBoardUpdatedAt(null);
      setMhPhase("idle");
      setBoardPhase("loading");

      // Curators' board — account-AGNOSTIC server snapshot, fired up front (it does
      // not depend on the soul scan) so it renders at network speed for any wallet.
      fetch("/api/board", { cache: "no-store" })
        .then((r) => r.json() as Promise<BoardData>)
        .then((bd) => {
          if (reqId !== reqRef.current) return;
          setBoard(boardForAccount(bd, acct));
          setBoardUpdatedAt(bd.updatedAt || null);
          setBoardPhase("loaded");
        })
        .catch(() => {
          if (reqId === reqRef.current) setBoardPhase("error");
        });

      try {
        const d = await loadSouls(client, acct);
        if (reqId !== reqRef.current) return;
        setData(d);
        setPhase("loaded");
        // Run the reaper + MH pass whenever the wallet HOLDS souls or has freed any —
        // covers pure holders (freed 0, bought on secondary) on the public profile.
        if (d.owned.length > 0 || d.freed > 0) {
          const rmap = REAPER_LIVE ? await getReaperState(client, d.owned) : new Map<number, ReaperState>();
          if (reqId !== reqRef.current) return;
          setReaper(rmap);
          const consumedById = new Map([...rmap].map(([id, s]) => [id, s.consumed]));
          setMhPhase("loading");
          try {
            const my = await buildMyMH(client, acct, d.owned, d.freed, d.acq, consumedById, REAPER_LIVE);
            if (reqId !== reqRef.current) return;
            setMyMh(my);
            setMhPhase("loaded");
          } catch {
            if (reqId === reqRef.current) setMhPhase("error");
          }
        }
      } catch {
        if (reqId === reqRef.current) setPhase("error");
      }
    },
    [client],
  );

  useEffect(() => {
    if (enabled && account) load(account);
    else reset();
  }, [enabled, account, load, reset]);

  // ── derived (same math as the old MySouls component body) ──
  const mine: MineEntry[] = data ? mineFrom(reaper, data.owned) : [];
  const consumed = mine.reduce((s, e) => s + e.consumed, 0);
  const contribution = (data?.freed ?? 0) + consumed;
  const deckRank = board ? board.myRank : data?.rank ?? 0;
  const deckTotal = board ? board.totalLibs : data?.totalLibs ?? 0;
  const tier = tierOf(contribution);

  return {
    phase,
    data,
    reaper,
    myMh,
    mhPhase,
    board,
    boardPhase,
    boardUpdatedAt,
    mine,
    consumed,
    contribution,
    deckRank,
    deckTotal,
    tier,
    reaperLive: REAPER_LIVE,
  };
}
