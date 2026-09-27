import type { NextRequest } from "next/server";
import { handlers } from "@/auth";
import { clientAddress, rateLimit, SIGN_IN_LIMIT, SIGN_IN_WINDOW_MS } from "@/lib/rate-limit";

/**
 * The Auth.js endpoints, rate-limited where the work is.
 *
 * `/login`'s server action is not the only way in: `GET /api/auth/csrf` plus
 * `POST /api/auth/signin/<provider>` starts a flow without touching it, and
 * `/api/auth/callback/<provider>` is where the expensive part happens (code
 * exchange, userinfo, GitHub membership calls). So the limit lives here, on
 * every entry point. `signin` shares the action's bucket; the callback has its
 * own so one complete flow costs one unit of each. `session`, `csrf` and
 * `providers` stay unlimited — they are cheap and polled by the client.
 */
const LIMITED = /^\/api\/auth\/(signin|callback)\//;

function limited(request: NextRequest): Response | null {
  const match = LIMITED.exec(request.nextUrl.pathname);
  if (!match) return null;

  const bucket = match[1] === "callback" ? "sign-in-callback" : "sign-in";
  const result = rateLimit(
    `${bucket}:${clientAddress(request.headers)}`,
    SIGN_IN_LIMIT,
    SIGN_IN_WINDOW_MS
  );
  if (result.ok) return null;

  return new Response("Too many requests", {
    status: 429,
    headers: { "Retry-After": String(result.retryAfter), "Cache-Control": "no-store" }
  });
}

export async function GET(request: NextRequest): Promise<Response> {
  return limited(request) ?? handlers.GET(request);
}

export async function POST(request: NextRequest): Promise<Response> {
  return limited(request) ?? handlers.POST(request);
}
