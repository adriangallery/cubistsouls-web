"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import Panel from "../components/Panel";
import CollabGrid from "./CollabGrid";
import MyReapers, { type MineEntry } from "./MyReapers";
import MyVessels, { useOwnedSplit } from "./MyVessels";
import Standing from "./Standing";
import { tierOf, type SoulsData } from "@/lib/souls";
import type { MyMHResult, MHBoardResult } from "@/lib/mh";

export type { DashPhase } from "./MuseumParts";
import type { DashPhase } from "./MuseumParts";

/* ================= dashboard (the control room) =================
   One deck bar on top, then a single stack of full-width panels, in the order
   Adrian set on 29-jul: YOUR STANDING (which now closes with the live Museum
   Hours counter and the curators' board), YOUR REAPERS, YOUR COLLECTION.
   The standing panel leads because it is the one that reads cleanly for every
   wallet; the two museum readouts that used to open the page are now its
   footer, where a slow board can't hold up the first thing you see.

   SHARED by /my-souls (mode="self", with the share card + WTP collab spark) and
   /curator/<address> (mode="public", read-only — no share row, no spark). The panel
   layout, MH hero, board and standing are IDENTICAL between the two so a curator's
   public page reads exactly like their own does.
   ================================================================ */
export default function Dashboard({
  mode,
  data,
  shareRow = null,
  address,
  collab,
  mine,
  consumed,
  contribution,
  deckRank,
  deckTotal,
  myMh,
  mhPhase,
  board,
  boardPhase,
  boardUpdatedAt,
  reaperLive,
  custodyCount = 0,
  onTransferred,
}: {
  mode: "self" | "public";
  data: SoulsData;
  shareRow?: React.ReactNode;
  address: string;
  collab: boolean;
  mine: MineEntry[];
  consumed: number;
  contribution: number;
  deckRank: number;
  deckTotal: number;
  myMh: MyMHResult | null;
  mhPhase: DashPhase;
  board: MHBoardResult | null;
  boardPhase: DashPhase;
  boardUpdatedAt: number | null;
  reaperLive: boolean;
  // souls kept behind this wallet's reapers: they count for the standing, but
  // they are not in the wallet and cannot be picked or transferred
  custodyCount?: number;
  // refresh after a batch send (mode "self" only — /curator stays read-only)
  onTransferred?: () => void;
}) {
  const tier = tierOf(contribution);
  const hasReapers = reaperLive && (mine.length > 0 || mode === "self");
  const consumedById = new Map(mine.map((e) => [e.id, e.consumed]));
  // vessels out of the souls grid, into their own section (on-chain split)
  const { souls: gridOwned, vessels } = useOwnedSplit(data.owned);

  return (
    <>
      {/* ---- deck: the recognition plaque, laid out as a status bar ---- */}
      <div className="deck">
        <div className="dk-id">
          <div className="dk-tier">Founding Liberator · {tier}</div>
          <div className="dk-headline">
            {mode === "self" ? "You freed " : "Freed "}
            <b>{data.freed}</b> soul{data.freed === 1 ? "" : "s"}
          </div>
        </div>
        <div className="dk-stats">
          <div className="dk-stat">
            <b>#{deckRank}</b>
            <span>of {deckTotal} liberators</span>
          </div>
          <div className="dk-stat">
            <b>{data.freed}</b>
            <span>souls freed</span>
          </div>
          {reaperLive ? (
            <div className="dk-stat">
              <b>{consumed}</b>
              <span>souls consumed</span>
            </div>
          ) : null}
          <div className="dk-stat">
            <b>{data.owned.length + custodyCount}</b>
            <span>{custodyCount > 0 ? `held now · ${custodyCount} behind reapers` : "held now"}</span>
          </div>
        </div>
        {shareRow ? <div className="dk-actions">{shareRow}</div> : null}
      </div>

      <div className={`dash${hasReapers ? "" : " no-reapers"}`}>
        <Standing
          data={data}
          myMh={myMh}
          mhPhase={mhPhase}
          board={board}
          boardPhase={boardPhase}
          boardUpdatedAt={boardUpdatedAt}
          mine={mine}
          consumed={consumed}
          contribution={contribution}
          reaperLive={reaperLive}
          mode={mode}
        />

        {reaperLive ? <MyReapers mine={mine} mode={mode} owned={gridOwned} onChanged={onTransferred} /> : null}

        <MyVessels vessels={vessels} mode={mode} />

        <Panel
          id="collection"
          title={mode === "self" ? "Your collection" : "Collection"}
          meta={
            custodyCount > 0
              ? `${gridOwned.length} in your wallet · ${custodyCount} behind your reapers`
              : `${gridOwned.length} soul${gridOwned.length === 1 ? "" : "s"}`
          }
          wide
        >
          {gridOwned.length ? (
            <CollabGrid
              owned={gridOwned}
              address={address}
              collabEnabled={collab}
              exhibits={myMh?.exhibits ?? null}
              consumedById={consumedById}
              canTransfer={mode === "self"}
              onTransferred={onTransferred}
            />
          ) : (
            <p className="mh-status">
              {mode === "self"
                ? "You've freed souls but hold none right now — the clock only runs on souls you keep."
                : "This wallet holds no souls right now — the clock only runs on souls kept."}
            </p>
          )}
        </Panel>
      </div>

      {mode === "self" ? (
        <div className="rewards">
          <h3>You were early</h3>
          <p>
            You reclaimed the collection when it mattered. Founding Liberators won&apos;t be forgotten — more on that
            soon.
          </p>
        </div>
      ) : null}
    </>
  );
}
