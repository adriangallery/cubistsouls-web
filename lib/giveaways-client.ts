// The ONE definition of the text a wallet signs to enter a giveaway.
//
// In its own file (no node:crypto, no Redis) so the client bundle can import
// it: the button signs this, the API route verifies against this. If the two
// ever drifted, entries would verify against a message the holder never agreed
// to — same discipline as lib/raffle.ts's entryMessage.

export function giveawayEntryMessage(giveawayId: number, address: string): string {
  return [
    "Cubist Souls — entering the giveaway",
    `Giveaway: ${giveawayId}`,
    `Wallet: ${address.toLowerCase()}`,
  ].join("\n");
}

/// The one-time LINK signature: ties a wallet to a Discord account so the
/// Enter button in the server can act for it. Naming the Discord id in the
/// signed text is what stops a signature taken for one account being replayed
/// to link the same wallet to another.
export function walletLinkMessage(discordId: string, address: string): string {
  return [
    "Cubist Souls — linking this wallet to my Discord",
    `Discord: ${discordId}`,
    `Wallet: ${address.toLowerCase()}`,
  ].join("\n");
}
