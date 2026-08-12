import { headers } from "next/headers";

/**
 * A small fixed-window rate limiter, in memory, per process.
 *
 * Deliberately not Redis. The portal is a single low-traffic replica and the
 * limits here exist to stop one client from turning a cheap request into
 * expensive work (apiserver reads, in-cluster probes, OAuth round-trips) — not
 * to enforce a billing quota. A shared store would add a dependency, a network
 * hop and a new failure mode to a defence that works fine approximately. With
 * more than one replica each replica enforces its own share of the budget,
 * which is the conservative direction for a limit of this kind.
 *
 * Counters are bounded: expired windows are swept on write and the map is
 * capped, so the limiter itself can never become the memory-exhaustion bug it
 * is meant to prevent.
 */

const MAX_TRACKED_KEYS = 5_000;

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the window resets; for the `Retry-After` header. */
  retryAfter: number;
}

function sweep(now: number): void {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}

/**
 * Consumes one unit for `key`. Windows are per key, so an authenticated user's
 * budget is theirs alone and one noisy client cannot lock out everyone else.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const existing = windows.get(key);

  if (!existing || existing.resetAt <= now) {
    if (windows.size >= MAX_TRACKED_KEYS) sweep(now);
    // Still full of live windows: refuse rather than grow without bound. This
    // only bites under a distributed flood, where refusing is the right answer.
    if (windows.size >= MAX_TRACKED_KEYS) return { ok: false, retryAfter: 60 };

    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }

  existing.count += 1;

  if (existing.count > limit) {
    return { ok: false, retryAfter: Math.ceil((existing.resetAt - now) / 1000) };
  }

  return { ok: true, retryAfter: 0 };
}

/**
 * A rate-limit key for a request with no session yet.
 *
 * `X-Forwarded-For` is a client-writable header: a request can arrive with
 * `X-Forwarded-For: 1.2.3.4` already set, and a limiter keyed on the *first*
 * entry is bypassed by varying that value per request. Traefik **appends** the
 * real peer address to whatever the client sent, so the **last** entry is the
 * only one the proxy vouches for. That is what is used here.
 *
 * If the app is ever exposed without a proxy in front of it, the header is
 * absent and everything shares one bucket — noisy, but never bypassable.
 */
export async function clientKey(prefix: string): Promise<string> {
  const forwarded = (await headers()).get("x-forwarded-for");
  const entries = forwarded?.split(",").map((entry) => entry.trim()).filter(Boolean) ?? [];
  const peer = entries.at(-1) ?? "unknown";

  return `${prefix}:${peer}`;
}
