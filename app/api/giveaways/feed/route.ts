// The feed SoulWatcher polls. Public and read-only — it says nothing the
// /giveaways wall doesn't already show. The bot dedupes on its side (its
// published_log), so this endpoint stays stateless: same list every time,
// newest first, compact fields only.

import { entryCount, listGiveaways, storageConfigured } from "@/lib/giveaways";

export const runtime = "nodejs";
// Same trap as /api/giveaways: a parameterless GET would be frozen at build.
export const dynamic = "force-dynamic";

export async function GET() {
  if (!storageConfigured()) {
    return Response.json({ giveaways: [] }, { headers: { "Cache-Control": "no-store" } });
  }
  try {
    const items = await listGiveaways(50);
    const counts = await Promise.all(items.map((g) => entryCount(g.id).catch(() => 0)));
    return Response.json(
      {
        giveaways: items.map((g, i) => ({
          id: g.id,
          title: g.title,
          project: g.project,
          prize: g.prize,
          imageUrl: g.imageUrl,
          projectUrl: g.projectUrl,
          winnersCount: g.winnersCount,
          endsAt: g.endsAt,
          requireSouls: g.requireSouls,
          status: g.status,
          createdAt: g.createdAt,
          drawnAt: g.drawnAt,
          winners: g.winners,
          entries: counts[i],
        })),
      },
      { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" } },
    );
  } catch {
    return Response.json({ giveaways: [] }, { headers: { "Cache-Control": "no-store" } });
  }
}
