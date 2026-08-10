// Public list of collab giveaways — what the /giveaways wall renders.
// Entry signatures never leave the store; this is titles, counts and winners.

import { entryCount, handlesFor, listGiveaways, storageConfigured, type Giveaway } from "@/lib/giveaways";

export const runtime = "nodejs";
// A parameterless GET gets statically evaluated at build time unless told
// otherwise — and at build time the store is empty. Always live.
export const dynamic = "force-dynamic";

export type PublicGiveaway = Omit<Giveaway, "createdBy"> & {
  entries: number;
  /** Only the name — the manager's Discord id stays server-side. */
  createdBy: string;
  /** Winner handles (parallel to `winners`), for drawn giveaways. */
  winnersInfo: { address: string; username: string | null }[];
};

export async function GET() {
  if (!storageConfigured()) {
    return Response.json({ giveaways: [] }, { headers: { "Cache-Control": "no-store" } });
  }
  try {
    const items = await listGiveaways();
    const [counts, infos] = await Promise.all([
      Promise.all(items.map((g) => entryCount(g.id).catch(() => 0))),
      Promise.all(
        items.map(async (g) => {
          if (g.status !== "drawn" || g.winners.length === 0) return [];
          const handles = await handlesFor(g.winners).catch(() => g.winners.map(() => null));
          return g.winners.map((address, j) => ({ address, username: handles[j] }));
        }),
      ),
    ]);
    const giveaways: PublicGiveaway[] = items.map((g, i) => ({
      ...g,
      createdBy: g.createdBy?.username ?? "—",
      entries: counts[i],
      winnersInfo: infos[i],
    }));
    return Response.json(
      { giveaways },
      { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=45" } },
    );
  } catch {
    return Response.json({ giveaways: [] }, { headers: { "Cache-Control": "no-store" } });
  }
}
