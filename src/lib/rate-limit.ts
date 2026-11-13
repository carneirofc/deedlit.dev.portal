import { isIP, isIPv6 } from "node:net";
import { headers } from "next/headers";
import { allowsPublicEdge } from "@/lib/edge";

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
 * is meant to prevent. At the cap the oldest window is evicted, never the new
 * key refused: refusing turned "fill the map with junk keys" into a lockout of
 * every legitimate client, which is a denial of service handed to whoever can
 * vary a key. Eviction only resets a budget early for whoever has the oldest
 * window, and someone holding 5,000 addresses is past what a per-address limit
 * can stop anyway — that is the edge's job, not this map's.
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
    if (existing) windows.delete(key);
    if (windows.size >= MAX_TRACKED_KEYS) sweep(now);
    // Still full of live windows: drop the oldest. Map iteration is insertion
    // order, and re-inserting on every new window keeps that order meaningful.
    if (windows.size >= MAX_TRACKED_KEYS) {
      const oldest = windows.keys().next().value;
      if (oldest !== undefined) windows.delete(oldest);
    }

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
 * Every request without a session, whatever the path: the `/login` render,
 * `/api/auth/session|csrf|providers` (which Auth.js leaves unlimited), redirects
 * to `/login`, 401s. Each is cheap alone; this caps what one client can make
 * the process do while holding nothing. A browser loading `/login` makes a
 * handful of these, so 120 a minute is far from any human pattern.
 */
export const ANONYMOUS_LIMIT = 120;
export const ANONYMOUS_WINDOW_MS = 60_000;

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
 * signal there is.
 *
 * It is read **only** when this deployment is public on purpose
 * (`PORTAL_ALLOW_PUBLIC_EDGE`, see `src/lib/edge.ts`). On a WireGuard-only
 * deployment every request that carries the header has already been refused
 * by the proxy, and any that reach here wrote it themselves: honouring it would
 * let a client rotate it to escape its bucket, or spray it to flood the map.
 * Even on a public deployment a client that reaches Traefik directly can still
 * forge it; closing that needs a tunnel-only Traefik entrypoint (infra repo).
 *
 * Without the header, the **last** `X-Forwarded-For` entry is used: Traefik
 * appends its real peer, and every entry before it is client-written. With
 * neither header everything shares one bucket — noisy, but never bypassable.
 */
export function clientAddress(requestHeaders: Headers): string {
  if (allowsPublicEdge()) {
    const cloudflare = requestHeaders.get("cf-connecting-ip")?.trim();
    if (cloudflare && isIP(cloudflare)) return `cf:${addressKey(cloudflare)}`;
  }

  const forwarded = requestHeaders.get("x-forwarded-for");
  const entries = forwarded?.split(",").map((entry) => entry.trim()).filter(Boolean) ?? [];
  const last = entries.at(-1);
  return last ? addressKey(last) : "unknown";
}

/**
 * The unit a client is counted as. An IPv4 address is one client. An IPv6
 * address is not: a single subscriber is routinely handed a whole /64 (2^64
 * addresses) and can pick a fresh one per request, so keying on the full
 * address lets anyone with ordinary home IPv6 escape every per-client limit.
 * The /64 is the smallest prefix one end site is expected to hold, so that is
 * the key. Anything that is not an IPv6 literal is returned as is.
 */
export function addressKey(address: string): string {
  if (!isIPv6(address)) return address;

  // Embedded IPv4 (::ffff:1.2.3.4) is an IPv4 client in disguise.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  if (mapped) return mapped[1];

  const [head, tail = ""] = address.toLowerCase().split("::");
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];
  const missing = 8 - headGroups.length - tailGroups.length;
  const groups = address.includes("::")
    ? [...headGroups, ...Array(Math.max(missing, 0)).fill("0"), ...tailGroups]
    : headGroups;

  const prefix = groups
    .slice(0, 4)
    .map((group) => Number.parseInt(group, 16).toString(16))
    .join(":");
  return `${prefix}::/64`;
}

/** A rate-limit key for the current request, which has no session yet. */
export async function clientKey(prefix: string): Promise<string> {
  return `${prefix}:${clientAddress(await headers())}`;
}
