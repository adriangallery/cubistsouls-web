// Step 1 of the collab-manager login: hand the visitor to Discord.
//
// Scopes: `identify` (who are you) + `guilds.members.read` (what roles do you
// hold in the Cubist server). The second one is what lets a "Collab Manager"
// ROLE grant access without redeploying an allowlist — the member lookup in the
// callback runs with the USER's token, so the web app never needs the bot token.
//
// The redirect URI must byte-match one registered on the SoulWatcher app in the
// Discord developer portal. Canonical prod value, overridable for local dev.

import { randomBytes } from "node:crypto";
import { authConfigured, oauthRedirectUri } from "@/lib/giveaways";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!authConfigured()) {
    return Response.json({ error: "auth not configured" }, { status: 500 });
  }

  // Where to land after the dance. Same-site paths only — an absolute URL
  // here would be an open redirect. Default is the desk; the public wall
  // passes ?next=/giveaways so holders come back to the cards.
  const nextRaw = new URL(req.url).searchParams.get("next") ?? "";
  const next = /^\/[a-zA-Z0-9/_-]*$/.test(nextRaw) ? nextRaw : "/giveaways/manage";

  const state = randomBytes(16).toString("hex");
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", process.env.DISCORD_CLIENT_ID as string);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", oauthRedirectUri());
  url.searchParams.set("scope", "identify guilds.members.read");
  url.searchParams.set("state", state);

  const headers = new Headers({
    Location: url.toString(),
    "Cache-Control": "no-store",
  });
  // 10 minutes to finish the dance; SameSite=Lax survives the top-level
  // redirect back from discord.com, which is exactly the case we need.
  headers.append(
    "Set-Cookie",
    `cs_oauth_state=${state}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
  );
  headers.append(
    "Set-Cookie",
    `cs_oauth_next=${encodeURIComponent(next)}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
  );
  return new Response(null, { status: 302, headers });
}
