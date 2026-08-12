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

  const { apps, health, collectedAt } = await getPortalSnapshot();

  return NextResponse.json(
    {
      collectedAt,
      services: apps.map((app) => ({
        id: app.id,
        name: app.name,
        host: app.host,
        url: app.url,
        category: app.category,
        health: health[app.id] ?? { state: "unknown", checkedAt: new Date().toISOString() }
      }))
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
