// Share landing for a built Cubist Soul.
//   /api/share?combo=<hex16>
// Crawlers read the OG/Twitter tags — og:image is the server-rendered composite.
// Humans get bounced to the builder with the combo preloaded.
//
// Ported from pikkazo-burn/api/share.js — identical HTML + headers.

export const runtime = "nodejs";
export const maxDuration = 10;

function validCombo(hex: string | null) {
  return typeof hex === "string" && /^[0-9a-f]{16}$/i.test(hex.trim());
}

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("combo");
  const combo = validCombo(raw) ? String(raw).trim().toLowerCase() : null;

  const proto = (req.headers.get("x-forwarded-proto") || "https").split(",")[0];
  const host = req.headers.get("host") || "cubistsouls.vercel.app";
  const origin = `${proto}://${host}`;

  const builderUrl = combo ? `/builder?combo=${combo}` : "/builder";
  const ogImage = combo
    ? `${origin}/api/render?combo=${combo}`
    : `${origin}/api/img?id=136`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>I built a Cubist Soul</title>
<meta property="og:type" content="website" />
<meta property="og:title" content="I built a Cubist Soul" />
<meta property="og:description" content="Composed from the recovered Cubist Souls trait library. Build your own." />
<meta property="og:image" content="${ogImage}" />
<meta property="og:url" content="${origin}${builderUrl}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="I built a Cubist Soul" />
<meta name="twitter:description" content="Composed from the recovered Cubist Souls trait library. Build your own." />
<meta name="twitter:image" content="${ogImage}" />
<meta http-equiv="refresh" content="0; url=${builderUrl}" />
<link rel="canonical" href="${origin}${builderUrl}" />
</head>
<body>
<p>Redirecting to the <a href="${builderUrl}">Soul Builder</a>…</p>
<script>location.replace(${JSON.stringify(builderUrl)});</script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
