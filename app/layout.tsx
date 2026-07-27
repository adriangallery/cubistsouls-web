import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Big_Shoulders_Display, Spectral, Space_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./components/Providers";

// Three brand families, one role each (DESIGN_SYSTEM §2). Loaded via next/font
// (no <link>) so the CSS variables below map to --disp / --serif / --mono.
const disp = Big_Shoulders_Display({
  subsets: ["latin"],
  weight: ["600", "700", "800", "900"],
  variable: "--font-disp",
  display: "swap",
});
const serif = Spectral({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});
const mono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-mono",
  display: "swap",
});

// OG/Twitter tags kept identical to prod (pikkazo-burn/index.html). The site is
// now PUBLIC (domain flip to cubistsouls.com): canonical URLs point at the real
// domain and og:image is absolute on cubistsouls.com/api/img — the old
// cubistsouls.vercel.app host is dead (Vercel 402), so nothing may reference it.
export const metadata: Metadata = {
  metadataBase: new URL("https://cubistsouls.com"),
  title: "Cubist Souls — freed by fire",
  description:
    "Burn a Pikkazo canvas and get its Cubist Soul — same number, original art recovered — minted to your wallet in the Cubist Souls collection.",
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🔥</text></svg>",
  },
  openGraph: {
    type: "website",
    title: "Burn Art — free your Cubist Soul",
    description:
      "Burn a Pikkazo canvas and you get its Cubist Soul — same number, original art recovered — minted straight to your wallet on Ethereum.",
    url: "https://cubistsouls.com",
    images: ["https://cubistsouls.com/api/img?id=136"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Burn Art — free your Cubist Soul",
    description:
      "Burn a Pikkazo canvas and you get its Cubist Soul — same number, original art recovered.",
    images: ["https://cubistsouls.com/api/img?id=136"],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${disp.variable} ${serif.variable} ${mono.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
