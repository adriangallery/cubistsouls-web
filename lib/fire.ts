// IS THE FIRE OPEN?
//
// The rite that lets a reaper burn canvases lives behind `reaperPaused` on the
// diamond, and Adrian closed it on 6-ago. The museum follows that switch rather
// than a flag in a file: nothing here needs a deploy to change its mind, so the
// day the fire is lit again every invitation to feed it comes back on its own.
//
// Read once per page and shared: this is a single boolean that changes about as
// often as never.

import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import { parseAbi } from "viem";
import { SOULS } from "./souls";

const FIRE_ABI = parseAbi(["function reaperPaused() view returns (bool)"]);

const TTL_MS = 240_000; // same 4 minutes as the museum's other readers
let memo: { open: boolean; ts: number } | null = null;

/// Whether the burning rite accepts offerings right now.
///
/// Starts as `null` — "we do not know yet" — so a page can hold the invitation
/// back instead of flashing it and taking it away. On a read failure it holds
/// the last known answer, and failing that stays closed: showing a ritual that
/// only produces failed transactions is worse than showing nothing.
export function useFireOpen(): boolean | null {
  const client = usePublicClient({ chainId: 1 });
  const [open, setOpen] = useState<boolean | null>(
    memo && Date.now() - memo.ts < TTL_MS ? memo.open : null,
  );

  useEffect(() => {
    if (!client) return;
    if (memo && Date.now() - memo.ts < TTL_MS) {
      setOpen(memo.open);
      return;
    }
    let stale = false;
    client
      .readContract({ address: SOULS, abi: FIRE_ABI, functionName: "reaperPaused" })
      .then((paused) => {
        const isOpen = !(paused as boolean);
        memo = { open: isOpen, ts: Date.now() };
        if (!stale) setOpen(isOpen);
      })
      .catch(() => {
        if (!stale) setOpen(memo ? memo.open : false);
      });
    return () => {
      stale = true;
    };
  }, [client]);

  return open;
}
