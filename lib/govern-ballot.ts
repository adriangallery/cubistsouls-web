// The CANONICAL ballot message — the exact string a voter signs (EIP-191
// personal_sign). Client (Proposal.tsx) and server (/api/govern/vote intake,
// /api/govern/votes freeze) import THIS builder, so the signed text and the
// verified text can never diverge — same discipline as lib/govern-propose.
//
// Format is FROZEN (documented in the vote API and the old govern preview):
//
//   Cubist Souls Govern
//   Proposal: <id>
//   Choice: <optionIndex>
//   Snapshot: <snapshotBlock>
//   Voter: <address lowercase>

export function ballotMessage(
  proposalId: string,
  choice: number,
  snapshotBlock: number | undefined,
  address: string,
): string {
  return `Cubist Souls Govern\nProposal: ${proposalId}\nChoice: ${choice}\nSnapshot: ${snapshotBlock ?? 0}\nVoter: ${address.toLowerCase()}`;
}
