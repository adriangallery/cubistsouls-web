// Cubist Souls × WTP! collab ("Fire is fine"). Every owned soul earns ONE free
// WTP generation. 2-click flow on /my-souls: fire → personal_sign → POST.
//
// The signature is EIP-191 personal_sign of a canonical message the WTP server
// re-derives and verifies. It MUST be byte-for-byte identical to the server's or
// the request is rejected — do not reformat collabMessage().
//
// CORS: WTP allows cubistsouls.com (and the OLD project's *.vercel.app). From
// THIS project's preview URL (cubistsouls-web.vercel.app) the browser preflight
// is blocked until WTP adds it to ALLOWED_ORIGINS — every call here is wrapped so
// a CORS/network failure degrades to a clean "warming up" message, never a crash.
// It goes fully live on the domain flip to cubistsouls.com.

export const WTP_API = "https://whattheprompt.art/api/collab/cubistsouls";
export const WTP_HOME = "https://whattheprompt.art/";
const COLLAB_TTL = 60 * 1000; // short sessionStorage TTL for status lookups

// BYTE-FOR-BYTE canonical message (joined with "\n", no trailing newline):
//   line1  "WTP x Cubist Souls"
//   line2  "Fire is fine"
//   line3  "Soul: <tokenId>"
//   line4  "Owner: <address lowercase>"
export function collabMessage(tokenId: number | string, address: string): string {
  return `WTP x Cubist Souls\nFire is fine\nSoul: ${tokenId}\nOwner: ${String(address).toLowerCase()}`;
}

export type CollabStatus = { used: boolean; imageUrl?: string; postUrl?: string };

function cacheGet(id: number | string): CollabStatus | null {
  try {
    const raw = sessionStorage.getItem("collab:" + id);
    if (raw) {
      const o = JSON.parse(raw);
      if (Date.now() - o.t < COLLAB_TTL) return o.v as CollabStatus;
    }
  } catch {}
  return null;
}
export function cacheSet(id: number | string, v: CollabStatus) {
  try { sessionStorage.setItem("collab:" + id, JSON.stringify({ t: Date.now(), v })); } catch {}
}

export async function collabStatus(id: number | string): Promise<CollabStatus> {
  const c = cacheGet(id);
  if (c) return c;
  const res = await fetch(`${WTP_API}/status?id=${encodeURIComponent(String(id))}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error("status " + res.status);
  const v = (await res.json()) as CollabStatus;
  cacheSet(id, v);
  return v;
}

export type GenerateResult =
  | { ok: true; imageUrl?: string; postUrl?: string }
  | { ok: false; status: number; imageUrl?: string; postUrl?: string; error?: string };

export async function collabGenerate(
  id: number | string,
  address: string,
  sig: string,
): Promise<GenerateResult> {
  const res = await fetch(`${WTP_API}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tokenId: String(id), address: address.toLowerCase(), sig }),
  });
  let data: any = {};
  try { data = await res.json(); } catch {}
  if (res.ok && data.ok) return { ok: true, imageUrl: data.imageUrl, postUrl: data.postUrl };
  return { ok: false, status: res.status, imageUrl: data.imageUrl, postUrl: data.postUrl, error: data.error };
}
