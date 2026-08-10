// Step 2: Discord sends the visitor back with a code. Exchange it, decide the
// manager verdict ONCE, seal it into the cookie, and land on the desk.
//
// Manager = allowlisted Discord id (CS_COLLAB_MANAGER_IDS)
//        OR holds the Collab Manager role (CS_COLLAB_MANAGER_ROLE_ID) in the
//           Cubist guild (CS_GUILD_ID) — read with the USER's OAuth token via
//           guilds.members.read, so no bot token lives in this app.
//
// Anyone may complete the login (the /giveaways/manage page tells non-managers
// they need the role); only the sealed manager=true flag opens the write APIs.

import {
  SESSION_COOKIE,
  SESSION_TTL_S,
  authConfigured,
  guildId,
  isManagerByAllowlist,
  managerRoleId,
  oauthRedirectUri,
  sealSession,
  type Session,
} from "@/lib/giveaways";

export const runtime = "nodejs";
// Never let the build freeze this: at build time authConfigured() is false and
// the baked answer would be a permanent "auth not configured" bounce.
export const dynamic = "force-dynamic";

function bounce(reason: string): Response {
  // Errors land back on the desk with a readable flag, never a bare JSON wall.
  return new Response(null, {
    status: 302,
    headers: {
      Location: `/giveaways/manage?auth_error=${encodeURIComponent(reason)}`,
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(req: Request) {
  if (!authConfigured()) return bounce("auth not configured");

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = (req.headers.get("cookie") ?? "").match(
    /(?:^|;\s*)cs_oauth_state=([^;]+)/,
  )?.[1];
  if (!code) return bounce("discord sent no code");
  if (!state || !cookieState || state !== cookieState) return bounce("state mismatch — try again");

  // code → token, with the SoulWatcher app's client credentials
  let accessToken = "";
  try {
    const r = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID as string,
        client_secret: process.env.DISCORD_CLIENT_SECRET as string,
        grant_type: "authorization_code",
        code,
        redirect_uri: oauthRedirectUri(),
      }),
    });
    if (!r.ok) return bounce("token exchange failed");
    accessToken = (await r.json()).access_token ?? "";
  } catch {
    return bounce("discord unreachable");
  }
  if (!accessToken) return bounce("token exchange failed");

  // who are you
  let me: { id?: string; username?: string; avatar?: string | null } = {};
  try {
    const r = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) return bounce("identity lookup failed");
    me = await r.json();
  } catch {
    return bounce("discord unreachable");
  }
  if (!me.id) return bounce("identity lookup failed");

  // the verdict: allowlist first (works with zero guild config), then role
  let manager = isManagerByAllowlist(me.id);
  const gid = guildId();
  const roleId = managerRoleId();
  if (!manager && gid && roleId) {
    try {
      const r = await fetch(`https://discord.com/api/users/@me/guilds/${gid}/member`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (r.ok) {
        const member = (await r.json()) as { roles?: string[] };
        manager = Array.isArray(member.roles) && member.roles.includes(roleId);
      }
      // a non-member gets 404 here — that is simply "not a manager"
    } catch {
      /* role check unavailable → the allowlist verdict stands */
    }
  }

  const session: Session = {
    discordId: me.id,
    username: me.username ?? "unknown",
    avatar: me.avatar ?? null,
    manager,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_S,
  };

  // back to wherever the login started (see the ?next= handling in login) —
  // strictly same-site, else the desk
  const nextCookie = (req.headers.get("cookie") ?? "").match(/(?:^|;\s*)cs_oauth_next=([^;]+)/)?.[1];
  const next = nextCookie ? decodeURIComponent(nextCookie) : "/giveaways/manage";
  const headers = new Headers({
    Location: /^\/[a-zA-Z0-9/_-]*$/.test(next) ? next : "/giveaways/manage",
    "Cache-Control": "no-store",
  });
  headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(sealSession(session))}; Path=/; Max-Age=${SESSION_TTL_S}; HttpOnly; Secure; SameSite=Lax`,
  );
  headers.append("Set-Cookie", "cs_oauth_state=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax");
  headers.append("Set-Cookie", "cs_oauth_next=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax");
  return new Response(null, { status: 302, headers });
}
