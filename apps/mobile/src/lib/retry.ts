import { ApiError } from "./api";

/** Waits between tries: about half a minute in all, enough to ride out a dead spot in an aisle. */
export const RETRY_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000, 12_000];

/** Worth trying again: no connection, the server busy or restarting, or a rate limit. Never a 4xx answer. */
export function retryable(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 0 || e.status === 429 || e.status === 502 || e.status === 503 || e.status === 504);
}

/** How long to wait before try `attempt` (0-based): the server's Retry-After for a 429, capped. */
export function delayFor(e: unknown, attempt: number, delays = RETRY_DELAYS_MS): number {
  const base = delays[Math.min(attempt, delays.length - 1)]!;
  if (e instanceof ApiError && e.status === 429) {
    const after = Number(e.details.retryAfterSeconds);
    if (after > 0) return Math.min(after * 1000, 15_000);
  }
  return base;
}

/**
 * Runs `fn` until it succeeds, retrying network and server-busy failures with backoff. The caller keeps
 * the same requestId across tries, so a scan that reached the server before the connection dropped is
 * still applied only once.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { delays?: number[]; sleep?: (ms: number) => Promise<void>; onRetry?: (attempt: number, e: unknown) => void } = {},
): Promise<T> {
  const delays = opts.delays ?? RETRY_DELAYS_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!retryable(e) || attempt >= delays.length) throw e;
      opts.onRetry?.(attempt + 1, e);
      await sleep(delayFor(e, attempt, delays));
    }
  }
}
