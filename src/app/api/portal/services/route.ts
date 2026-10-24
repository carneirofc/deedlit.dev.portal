import { NextResponse } from "next/server";
import { auth, sessionKey } from "@/auth";
import { getPortalSnapshot } from "@/features/services/server/snapshot";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** 30 requests a minute is far above any human use of a dashboard endpoint. */
const LIMIT = 30;
const WINDOW_MS = 60_000;

/**
 * JSON view of the portal, for scripting against.
 *
 * The session is re-checked here rather than relying on `src/proxy.ts`: route
 * handlers are their own entry point, and this response carries internal
 * hostnames.
 */
export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Keyed on the session identity, not on a header. The identity comes out of
  // an encrypted, signed cookie the client cannot rewrite, so a caller cannot
  // shed their bucket by varying anything they control — the limit follows the
  // account, not the connection.
  const limited = rateLimit(`portal-services:${sessionKey(session)}`, LIMIT, WINDOW_MS);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } }
    );
  }

  const { apps, health, collectedAt, degraded } = await getPortalSnapshot();

  // Discovery is failing and there is nothing earlier to fall back on: an
  // empty list with 200 would be indistinguishable from an empty cluster.
  // Only the failure enum is exposed — never apiserver detail.
  if (degraded && !degraded.servingLastGood) {
    return NextResponse.json(
      { error: "Service discovery unavailable", degraded: { reason: degraded.reason, since: degraded.since } },
      { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "5" } }
    );
  }

  return NextResponse.json(
    {
      collectedAt,
      // Present when this is a previous good snapshot served during a failure.
      ...(degraded ? { degraded: { reason: degraded.reason, since: degraded.since } } : {}),
      services: apps.map((app) => ({
        id: app.id,
        name: app.name,
        description: app.description,
        host: app.host,
        url: app.url,
        namespace: app.namespace,
        category: app.category,
        health: health[app.id] ?? { state: "unknown", checkedAt: new Date().toISOString() }
      }))
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
