// The collab managers' desk — every write to a giveaway goes through here,
// gated by the sealed Discord session (manager=true; see the auth callback).
//
// POST {action:"create", ...fields}      → a new open giveaway
// POST {action:"cancel", id}             → open → cancelled (nothing is drawn)
// POST {action:"draw", id, force?}       → open → drawn; picks the winners.
//      Refused while entries are still open unless force=true — a draw before
//      the announced close is exactly the rug this tool exists to avoid.
// GET  ?id=N&csv=entries|winners         → CSV download for the partner
//      (Alphabot's most-used button: the winner list is what the collab
//      manager actually hands over for the mint's allowlist).

import {
  createGiveaway,
  drawWinners,
  getGiveaway,
  listEntries,
  makeSeed,
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
    const now = Math.floor(Date.now() / 1000);
    if (now < g.endsAt && body.force !== true) {
      return Response.json(
        { error: "entries are still open — wait for the close, or pass force" },
        { status: 409 },
      );
    }
    const entries = await listEntries(id);
    const seed = makeSeed();
    g.winners = drawWinners(entries.map((e) => e.address), seed, g.winnersCount);
    g.seed = seed;
    g.drawnAt = now;
    g.status = "drawn";
    // closing early (force) also closes entries — the document's endsAt is
    // what the entry route checks, so pull it back to the draw moment
    if (g.endsAt > now) g.endsAt = now;
    await saveGiveaway(g);
    return Response.json({ ok: true, giveaway: g }, { headers: { "Cache-Control": "no-store" } });
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
    rows = ["address", ...g.winners];
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
