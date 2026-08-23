// Cubist Souls Govern — the MERGED proposals feed.
//   GET /api/govern/proposals
// One list: the museum's deploy-gated proposals.json entries plus the reaper
// proposals created live via POST /api/govern/propose (Redis). This is what
// the /govern page renders and what the vote API validates against — and what
// SoulWatcher polls to announce new proposals in Discord.

import { loadAllProposals } from "@/lib/govern-server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const all = await loadAllProposals(req);
    return Response.json(all, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=0, s-maxage=10, stale-while-revalidate=30",
      },
    });
  } catch {
    return Response.json({ error: "proposals unavailable" }, { status: 502 });
  }
}
