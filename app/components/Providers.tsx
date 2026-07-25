"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { config } from "@/config/wagmi";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000 } },
});

// RainbowKit theme wired to the Direction B "Freed by Fire" tokens so the connect
// modal reads as part of the museum, not a stock wallet sheet: oxblood surface,
// ember accent, gild highlights, bone text, Space Mono labels.
const csTheme = darkTheme({
  accentColor: "#ff5b18", // --ember
  accentColorForeground: "#1a0500",
  borderRadius: "medium",
  fontStack: "system",
  overlayBlur: "small",
});
csTheme.colors.modalBackground = "#1a0608"; // --wall
csTheme.colors.modalBorder = "rgba(224,165,32,.4)"; // --gild @ .4
csTheme.colors.profileForeground = "#21100c"; // --char
csTheme.colors.closeButtonBackground = "rgba(224,165,32,.14)";
csTheme.colors.closeButton = "#f4ede1"; // --bone
csTheme.colors.actionButtonBorder = "rgba(224,165,32,.35)";
csTheme.colors.actionButtonBorderMobile = "rgba(224,165,32,.35)";
csTheme.colors.generalBorder = "rgba(224,165,32,.28)";
csTheme.colors.menuItemBackground = "rgba(58,15,22,.55)"; // --wall-raise
csTheme.colors.connectButtonBackground = "#1a0608";
csTheme.colors.modalText = "#f4ede1";
csTheme.colors.modalTextSecondary = "#c99a8f"; // --mute
csTheme.fonts.body =
  "var(--font-mono), ui-monospace, SFMono-Regular, Menlo, monospace";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={csTheme} appInfo={{ appName: "Cubist Souls" }} modalSize="compact">
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
