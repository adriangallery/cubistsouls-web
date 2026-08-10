// Who is at the desk. GET → the session (public fields only) or {session:null}.
// POST {logout:true} → clears the cookie. Kept in one route so the manage page
// has a single auth endpoint to talk to.

import { SESSION_COOKIE, sessionFrom } from "@/lib/giveaways";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const s = sessionFrom(req);
  return Response.json(
    s
      ? {
          session: {
            discordId: s.discordId,
            username: s.username,
            avatar: s.avatar,
            manager: s.manager,
          },
        }
      : { session: null },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "Set-Cookie": `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
      "Cache-Control": "no-store",
    },
  });
}
