// Shareable recognition card — 1200×630 canvas drawn client-side (WTP pattern),
// ported from my-souls.html. Same dimensions, same layout, same data; only the
// skin moves to Direction B "Freed by Fire" (dark ember wall instead of the old
// oxblood-red gradient). Both flavours (classic + Museum Hours) share the surface.

export type CardStats = {
  freed: number;
  rank: number;
  total: number;
  held: number;
  tier: string;
  mh?: number; // present only in ?mh=1 mode
  rate?: number;
};

function roundRect(x: CanvasRenderingContext2D, X: number, Y: number, w: number, h: number, r: number) {
  x.beginPath();
  x.moveTo(X + r, Y);
  x.arcTo(X + w, Y, X + w, Y + h, r);
  x.arcTo(X + w, Y + h, X, Y + h, r);
  x.arcTo(X, Y + h, X, Y, r);
  x.arcTo(X, Y, X + w, Y, r);
  x.closePath();
}

export async function drawCard(s: CardStats): Promise<Blob> {
  try {
    await (document as any).fonts?.ready;
  } catch {}
  const W = 1200;
  const H = 630;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const x = c.getContext("2d")!;

  // ── Direction B surface: dark ember wall, top-lit, with a bottom ember glow ──
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#2a0a0d");
  g.addColorStop(0.55, "#1a0608");
  g.addColorStop(1, "#0e0405");
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  const glow = x.createRadialGradient(W / 2, H + 60, 60, W / 2, H + 60, W * 0.7);
  glow.addColorStop(0, "rgba(255,91,24,.28)");
  glow.addColorStop(1, "rgba(255,91,24,0)");
  x.fillStyle = glow;
  x.fillRect(0, 0, W, H);
  // faint scanlines (kept from the original for texture)
  x.strokeStyle = "rgba(0,0,0,.14)";
  x.lineWidth = 1;
  for (let y = 0; y < H; y += 24) {
    x.beginPath();
    x.moveTo(0, y + 0.5);
    x.lineTo(W, y + 0.5);
    x.stroke();
  }
  // gold frame
  const m = 54;
  roundRect(x, m, m, W - 2 * m, H - 2 * m, 18);
  x.fillStyle = "rgba(14,4,5,.35)";
  x.fill();
  x.strokeStyle = "rgba(224,165,32,.55)";
  x.lineWidth = 2;
  x.stroke();

  x.textAlign = "center";

  if (s.mh != null) {
    // ── Museum Hours flavour ──
    x.fillStyle = "#e0a520";
    x.font = "700 24px 'Space Mono', monospace";
    x.fillText("🏛 MUSEUM HOURS", W / 2, 140, W - 160);
    x.fillStyle = "#c99a8f";
    x.font = "400 18px 'Space Mono', monospace";
    x.fillText(`FOUNDING LIBERATOR · ${String(s.tier).toUpperCase()}`, W / 2, 176, W - 160);
    const num = Math.floor(s.mh).toLocaleString("en-US");
    const unit = " MH";
    x.font = "800 118px 'Big Shoulders Display', sans-serif";
    const wn = x.measureText(num).width;
    x.font = "800 64px 'Big Shoulders Display', sans-serif";
    const wu = x.measureText(unit).width;
    const sx = (W - (wn + wu)) / 2;
    const y1 = 306;
    x.textAlign = "left";
    x.fillStyle = "#f4ede1";
    x.font = "800 118px 'Big Shoulders Display', sans-serif";
    x.fillText(num, sx, y1);
    x.fillStyle = "#e0a520";
    x.font = "800 64px 'Big Shoulders Display', sans-serif";
    x.fillText(unit, sx + wn, y1);
    x.textAlign = "center";
    x.fillStyle = "#ff5b18";
    x.font = "700 24px 'Space Mono', monospace";
    x.fillText(
      `+${(s.rate ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} MH / HOUR`,
      W / 2,
      356,
    );
    const cols: [string, string][] = [
      [`#${s.rank}`, `OF ${s.total} LIBERATORS`],
      [String(s.freed), "SOULS FREED"],
      [String(s.held), "HELD NOW"],
    ];
    const cx = [W / 2 - 320, W / 2, W / 2 + 320];
    const sy = 468;
    cols.forEach((col, i) => {
      x.fillStyle = "#e0a520";
      x.font = "800 58px 'Big Shoulders Display', sans-serif";
      x.fillText(col[0], cx[i], sy);
      x.fillStyle = "#c99a8f";
      x.font = "400 17px 'Space Mono', monospace";
      x.fillText(col[1], cx[i], sy + 40);
    });
    x.fillStyle = "rgba(244,237,225,.62)";
    x.font = "700 19px 'Space Mono', monospace";
    x.fillText("CUBIST SOULS · THE MUSEUM KEEPS ITS SECRETS · CUBISTSOULS.COM", W / 2, H - 88, W - 180);
  } else {
    // ── Classic "You freed N souls" flavour ──
    x.fillStyle = "#e0a520";
    x.font = "700 22px 'Space Mono', monospace";
    x.fillText(`FOUNDING LIBERATOR · ${String(s.tier).toUpperCase()}`, W / 2, 152, W - 160);
    x.font = "800 92px 'Big Shoulders Display', sans-serif";
    const pre = "YOU FREED ";
    const num = String(s.freed);
    const post = " SOULS";
    const wp = x.measureText(pre).width;
    const wn = x.measureText(num).width;
    const ws = x.measureText(post).width;
    const sx = (W - (wp + wn + ws)) / 2;
    const y1 = 278;
    x.textAlign = "left";
    x.fillStyle = "#f4ede1";
    x.fillText(pre, sx, y1);
    x.fillStyle = "#ff5b18";
    x.fillText(num, sx + wp, y1);
    x.fillStyle = "#f4ede1";
    x.fillText(post, sx + wp + wn, y1);
    x.textAlign = "center";
    const cols: [string, string][] = [
      [`#${s.rank}`, `OF ${s.total} LIBERATORS`],
      [String(s.freed), "SOULS FREED"],
      [String(s.held), "HELD NOW"],
    ];
    const cx = [W / 2 - 320, W / 2, W / 2 + 320];
    const sy = 420;
    cols.forEach((col, i) => {
      x.fillStyle = "#e0a520";
      x.font = "800 62px 'Big Shoulders Display', sans-serif";
      x.fillText(col[0], cx[i], sy);
      x.fillStyle = "#c99a8f";
      x.font = "400 18px 'Space Mono', monospace";
      x.fillText(col[1], cx[i], sy + 44);
    });
    x.fillStyle = "rgba(244,237,225,.62)";
    x.font = "700 21px 'Space Mono', monospace";
    x.fillText("CUBIST SOULS · CUBISTSOULS.COM", W / 2, H - 92);
  }

  return await new Promise<Blob>((res) => c.toBlob((b) => res(b!), "image/png"));
}

export function shareText(s: CardStats): string {
  if (s.mh != null) {
    return `My souls have kept ${Math.floor(s.mh).toLocaleString("en-US")} Museum Hours 🏛 I freed ${s.freed} Cubist Soul${s.freed === 1 ? "" : "s"} — Liberator #${s.rank} of ${s.total} on @cubistsouls. The museum keeps its secrets.\n\nhttps://cubistsouls.com/my-souls 🔥`;
  }
  return `I freed ${s.freed} Cubist Soul${s.freed === 1 ? "" : "s"} 🖼️ Founding Liberator #${s.rank} of ${s.total} on @cubistsouls. Reclaimed by the community.\n\nhttps://cubistsouls.com/my-souls 🔥`;
}

export function downloadBlob(blob: Blob, name: string) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 2000);
}
