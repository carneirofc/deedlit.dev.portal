import { isIP } from "node:net";
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
 * Sign-in is unauthenticated, so it is keyed on the client address rather than
 * a session. The expensive step is the OAuth callback (code exchange, userinfo
 * and, for GitHub, membership calls); ten a minute per client is generous for
 * a human and unhelpful as an amplifier. Shared by the `/login` server action
 * and the Auth.js route handler.
 */
export const SIGN_IN_LIMIT = 10;
export const SIGN_IN_WINDOW_MS = 60_000;

/**
 * The client address a request with no session is counted against.
 *
 * Public traffic arrives Cloudflare → cloudflared (tunnel) → Traefik → here,
 * so the TCP peer Traefik records is always the tunnel pod: `X-Forwarded-For`'s
 * last entry is the same for every visitor, and keying on it made one bucket
 * for the whole internet — ten requests a minute from anyone locked everyone
 * out of sign-in.
 *
 * Cloudflare's edge sets `CF-Connecting-IP` to the real client and overwrites
 * any client-supplied value, so on the tunnel path it is the only per-client
 * signal there is, and it is preferred when it holds an IP literal.
 *
 * The trade-off, stated plainly: a client that reaches Traefik *directly* (the
 * LAN LoadBalancer, for non-public Ingresses) can set `CF-Connecting-IP` itself
 * and rotate it to escape its bucket. That lets someone already on the trusted
 * LAN bypass a limit — far better than letting anyone on the internet deny
 * sign-in to everyone. Closing it needs Traefik to strip the header for
 * non-tunnel peers (a tunnel-only entrypoint); see the infra repo.
 *
 * Without the header, the **last** `X-Forwarded-For` entry is used: Traefik
 * appends its real peer, and every entry before it is client-written. With
 * neither header everything shares one bucket — noisy, but never bypassable.
 */
export function clientAddress(requestHeaders: Headers): string {
  const cloudflare = requestHeaders.get("cf-connecting-ip")?.trim();
  if (cloudflare && isIP(cloudflare)) return `cf:${cloudflare}`;

  const forwarded = requestHeaders.get("x-forwarded-for");
  const entries = forwarded?.split(",").map((entry) => entry.trim()).filter(Boolean) ?? [];
  return entries.at(-1) ?? "unknown";
}

/** A rate-limit key for the current request, which has no session yet. */
export async function clientKey(prefix: string): Promise<string> {
  return `${prefix}:${clientAddress(await headers())}`;
}
