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

export async function GET() {
  if (!authConfigured()) {
    return Response.json({ error: "auth not configured" }, { status: 500 });
  }

  const state = randomBytes(16).toString("hex");
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", process.env.DISCORD_CLIENT_ID as string);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", oauthRedirectUri());
  url.searchParams.set("scope", "identify guilds.members.read");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "none");

  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      // 10 minutes to finish the dance; SameSite=Lax survives the top-level
      // redirect back from discord.com, which is exactly the case we need.
      "Set-Cookie": `cs_oauth_state=${state}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
      "Cache-Control": "no-store",
    },
  });
}
