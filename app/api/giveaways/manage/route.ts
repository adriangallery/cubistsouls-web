// The collab managers' desk — every write to a giveaway goes through here,
// gated by the sealed Discord session (manager=true; see the auth callback).
//
// POST {action:"create", ...fields}      → a new open giveaway
// POST {action:"cancel", id}             → open → cancelled (nothing is drawn)
// POST {action:"draw", id, force?}       → open → drawn; picks the winners.
//      Refused while entries are still open unless force=true — a draw before
//      the announced close is exactly the rug this tool exists to avoid.
// POST {action:"edit", id, ...fields}    → amend an OPEN giveaway (copy, art,
//      close, winners count, souls gate, autoDraw). Drawn history is frozen.
// POST {action:"reroll", id, address}    → replace one winner of a DRAWN
//      giveaway with a substitute derived from the original seed — Alphabot's
//      re-roll, kept replayable (see rerollWinner in the lib).
// GET  ?id=N&csv=entries|winners         → CSV download for the partner
//      (Alphabot's most-used button: the winner list is what the collab
//      manager actually hands over for the mint's allowlist).

import { isAddress } from "viem";
import {
  createGiveaway,
  drawAndSave,
  getGiveaway,
  handlesFor,
  listEntries,
  rerollWinner,
  saveGiveaway,
  sessionFrom,
  storageConfigured,
  type Session,
} from "@/lib/giveaways";

export const runtime = "nodejs";

function requireManager(req: Request): Session | Response {
  const s = sessionFrom(req);
  if (!s) return Response.json({ error: "sign in with Discord first" }, { status: 401 });
  if (!s.manager) return Response.json({ error: "collab manager access required" }, { status: 403 });
  return s;
}

const MAX = { title: 80, project: 60, prize: 240, url: 300 };

function cleanText(v: unknown, max: number): string {
  return String(v ?? "").trim().slice(0, max);
}

function cleanUrl(v: unknown): string {
  const s = cleanText(v, MAX.url);
  if (!s) return "";
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : "";
  } catch {
    return "";
  }
}

export async function POST(req: Request) {
  if (!storageConfigured()) return Response.json({ error: "storage not configured" }, { status: 500 });
  const gate = requireManager(req);
  if (gate instanceof Response) return gate;
  const session = gate;

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad body" }, { status: 400 });
  }

  const action = String(body.action ?? "");

  if (action === "create") {
    const title = cleanText(body.title, MAX.title);
    const project = cleanText(body.project, MAX.project);
    if (!title || !project) {
      return Response.json({ error: "title and project are required" }, { status: 400 });
    }
    const winnersCount = Number(body.winnersCount);
    if (!Number.isInteger(winnersCount) || winnersCount < 1 || winnersCount > 5000) {
      return Response.json({ error: "winners must be 1–5000" }, { status: 400 });
    }
    const endsAt = Number(body.endsAt);
    const now = Math.floor(Date.now() / 1000);
    // at least 10 minutes, at most 60 days — fat-finger guards, not policy
    if (!Number.isFinite(endsAt) || endsAt < now + 600 || endsAt > now + 60 * 86400) {
      return Response.json({ error: "close must be between 10 minutes and 60 days from now" }, { status: 400 });
    }
    const requireSouls = Number(body.requireSouls ?? 0);
    if (!Number.isInteger(requireSouls) || requireSouls < 0 || requireSouls > 1000) {
      return Response.json({ error: "requireSouls must be 0–1000" }, { status: 400 });
    }

    const g = await createGiveaway({
      title,
      project,
      prize: cleanText(body.prize, MAX.prize),
      imageUrl: cleanUrl(body.imageUrl),
      projectUrl: cleanUrl(body.projectUrl),
      winnersCount,
      endsAt: Math.floor(endsAt),
      requireSouls,
      autoDraw: body.autoDraw === true,
      dmWinners: body.dmWinners === true,
      createdBy: { discordId: session.discordId, username: session.username },
    });
    return Response.json({ ok: true, giveaway: g }, { headers: { "Cache-Control": "no-store" } });
  }

  // cancel and draw both start from an existing open giveaway
  const id = Number(body.id);
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "bad giveaway" }, { status: 400 });
  const g = await getGiveaway(id).catch(() => null);
  if (!g) return Response.json({ error: "not found" }, { status: 404 });

  if (action === "cancel") {
    if (g.status !== "open") return Response.json({ error: "only open giveaways cancel" }, { status: 409 });
    g.status = "cancelled";
    await saveGiveaway(g);
    return Response.json({ ok: true, giveaway: g }, { headers: { "Cache-Control": "no-store" } });
  }

  if (action === "draw") {
    if (g.status !== "open") return Response.json({ error: "already settled" }, { status: 409 });
    if (Math.floor(Date.now() / 1000) < g.endsAt && body.force !== true) {
      return Response.json(
        { error: "entries are still open — wait for the close, or pass force" },
        { status: 409 },
      );
    }
    const drawn = await drawAndSave(g);
    return Response.json({ ok: true, giveaway: drawn }, { headers: { "Cache-Control": "no-store" } });
  }

  if (action === "edit") {
    if (g.status !== "open") return Response.json({ error: "only open giveaways edit" }, { status: 409 });
    if (body.title !== undefined) {
      const t = cleanText(body.title, MAX.title);
      if (!t) return Response.json({ error: "title cannot be empty" }, { status: 400 });
      g.title = t;
    }
    if (body.project !== undefined) {
      const p = cleanText(body.project, MAX.project);
      if (!p) return Response.json({ error: "project cannot be empty" }, { status: 400 });
      g.project = p;
    }
    if (body.prize !== undefined) g.prize = cleanText(body.prize, MAX.prize);
    if (body.imageUrl !== undefined) g.imageUrl = cleanUrl(body.imageUrl);
    if (body.projectUrl !== undefined) g.projectUrl = cleanUrl(body.projectUrl);
    if (body.winnersCount !== undefined) {
      const w = Number(body.winnersCount);
      if (!Number.isInteger(w) || w < 1 || w > 5000) {
        return Response.json({ error: "winners must be 1–5000" }, { status: 400 });
      }
      g.winnersCount = w;
    }
    if (body.endsAt !== undefined) {
      const e = Number(body.endsAt);
      const now = Math.floor(Date.now() / 1000);
      // an edit may extend or shorten, but never into the past — closing now
      // is what the draw/cancel buttons are for
      if (!Number.isFinite(e) || e < now + 300 || e > now + 60 * 86400) {
        return Response.json({ error: "close must be 5 minutes to 60 days from now" }, { status: 400 });
      }
      g.endsAt = Math.floor(e);
    }
    if (body.requireSouls !== undefined) {
      const r = Number(body.requireSouls);
      if (!Number.isInteger(r) || r < 0 || r > 1000) {
        return Response.json({ error: "requireSouls must be 0–1000" }, { status: 400 });
      }
      g.requireSouls = r;
    }
    if (body.autoDraw !== undefined) g.autoDraw = body.autoDraw === true;
    if (body.dmWinners !== undefined) g.dmWinners = body.dmWinners === true;
    await saveGiveaway(g);
    return Response.json({ ok: true, giveaway: g }, { headers: { "Cache-Control": "no-store" } });
  }

  // Housekeeping, not deletion: an archived giveaway leaves the public wall
  // and the bot's feed, but its entries and CSVs remain forever.
  if (action === "archive" || action === "unarchive") {
    if (g.status === "open") {
      return Response.json({ error: "settle it first — open giveaways don't archive" }, { status: 409 });
    }
    g.archived = action === "archive";
    await saveGiveaway(g);
    return Response.json({ ok: true, giveaway: g }, { headers: { "Cache-Control": "no-store" } });
  }

  if (action === "reroll") {
    if (g.status !== "drawn") return Response.json({ error: "re-roll needs a drawn giveaway" }, { status: 409 });
    const address = String(body.address ?? "");
    if (!isAddress(address)) return Response.json({ error: "bad address" }, { status: 400 });
    const updated = await rerollWinner(g, address);
    if (!updated) return Response.json({ error: "that wallet is not a winner" }, { status: 400 });
    return Response.json({ ok: true, giveaway: updated }, { headers: { "Cache-Control": "no-store" } });
  }

  return Response.json({ error: "unknown action" }, { status: 400 });
}

export async function GET(req: Request) {
  if (!storageConfigured()) return Response.json({ error: "storage not configured" }, { status: 500 });
  const gate = requireManager(req);
  if (gate instanceof Response) return gate;

  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id"));
  const kind = url.searchParams.get("csv");
  if (!Number.isInteger(id) || id < 1 || (kind !== "entries" && kind !== "winners")) {
    return Response.json({ error: "want ?id=N&csv=entries|winners" }, { status: 400 });
  }
  const g = await getGiveaway(id).catch(() => null);
  if (!g) return Response.json({ error: "not found" }, { status: 404 });

  let rows: string[];
  if (kind === "winners") {
    // the partner gets the handle too — chasing winners is half the job
    const handles = await handlesFor(g.winners).catch(() => g.winners.map(() => null));
    rows = ["address,discord", ...g.winners.map((w, i) => `${w},${handles[i] ?? ""}`)];
  } else {
    const entries = await listEntries(id);
    entries.sort((a, b) => a.ts - b.ts);
    rows = ["address,entered_at", ...entries.map((e) => `${e.address},${e.ts}`)];
  }
  return new Response(rows.join("\n") + "\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="giveaway-${id}-${kind}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
