// A wallet's history on the wall — powers /giveaways/mine. Public by address
// (the same facts the per-card "entered" check already exposes), no signature
// needed to READ your own trail.

import { isAddress } from "viem";
import { hasEntered, listGiveaways, storageConfigured } from "@/lib/giveaways";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!storageConfigured()) return Response.json({ mine: [] }, { headers: { "Cache-Control": "no-store" } });
  const address = new URL(req.url).searchParams.get("address") ?? "";
  if (!isAddress(address)) return Response.json({ error: "bad address" }, { status: 400 });

  try {
    const items = await listGiveaways();
    const entered = await Promise.all(items.map((g) => hasEntered(g.id, address).catch(() => false)));
    const a = address.toLowerCase();
    const mine = items
      .map((g, i) => ({ g, in: entered[i] }))
      .filter((x) => x.in)
      .map(({ g }) => ({
        id: g.id,
        title: g.title,
        project: g.project,
        prize: g.prize,
        status: g.status,
        endsAt: g.endsAt,
        drawnAt: g.drawnAt,
        won: g.status === "drawn" && g.winners.includes(a),
      }));
    return Response.json({ mine }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ mine: [] }, { headers: { "Cache-Control": "no-store" } });
  }
}
