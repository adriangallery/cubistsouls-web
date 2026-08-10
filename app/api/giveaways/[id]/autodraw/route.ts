// Auto-draw trigger — SoulWatcher's poller calls this when it sees an open
// giveaway with autoDraw=true whose close has passed. S2S only. Idempotent:
// an already-drawn giveaway answers ok so a repeated poll is harmless, and a
// giveaway that did NOT opt into autoDraw refuses — the manager's click stays
// the only way to settle those.

import { botKeyOk, drawAndSave, getGiveaway, storageConfigured } from "@/lib/giveaways";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!botKeyOk(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!storageConfigured()) return Response.json({ error: "storage not configured" }, { status: 500 });

  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "bad giveaway" }, { status: 400 });

  const g = await getGiveaway(id).catch(() => null);
  if (!g) return Response.json({ error: "not found" }, { status: 404 });
  if (g.status === "drawn") return Response.json({ ok: true, already: true });
  if (g.status !== "open") return Response.json({ error: "not open" }, { status: 409 });
  if (g.autoDraw !== true) return Response.json({ error: "not an auto-draw giveaway" }, { status: 403 });
  if (Math.floor(Date.now() / 1000) < g.endsAt) {
    return Response.json({ error: "still open" }, { status: 409 });
  }

  const drawn = await drawAndSave(g);
  return Response.json(
    { ok: true, winners: drawn.winners, seed: drawn.seed },
    { headers: { "Cache-Control": "no-store" } },
  );
}
