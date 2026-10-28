// Search rate limit (T-SEC-015, search part). Exports keep their own limit, counted from their audit rows
// (exports.ts); a search is not an audited action, so it is counted by app.rate_take() (migration 0010).
import type { Tx } from "./db";
import { RateLimited } from "./exports";

export const SEARCH_POLICY = { perWindow: 30, windowMinutes: 1 } as const; // PMC (D-OPS-1)

/** Counts one search for the session's user, inside the caller's transaction; throws RateLimited above the limit. */
export async function limitSearch(tx: Tx): Promise<void> {
  const [r] = await tx.$queryRaw<{ ok: boolean }[]>`
    select app.rate_take('search', ${SEARCH_POLICY.perWindow}::int, ${SEARCH_POLICY.windowMinutes}::int) as ok`;
  if (!r?.ok) throw new RateLimited(SEARCH_POLICY.windowMinutes * 60);
}
