// Collection-level metadata (OpenSea contractURI). The diamond's renderer
// points contractURI() here.
//
// Ported from pikkazo-burn/api/collection.js — byte-identical JSON + headers.

export const runtime = "nodejs";

const LORE =
  "Ten thousand cubist portraits were abandoned by their maker. Inside every canvas, a soul stayed trapped. " +
  "Each Cubist Soul exists because its holder burned the original canvas on Ethereum, an irreversible act of liberation. " +
  "The soul kept its number, and the face it wore in the canvas that held it.";

export async function GET() {
  const body = {
    name: "Cubist Souls",
    description: LORE,
    image: "https://cubistsouls.vercel.app/soul.jpg",
    external_link: "https://cubistsouls.vercel.app",
  };
  return Response.json(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
