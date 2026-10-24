import type { Session } from "next-auth";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

/**
 * The server-side session check every protected page runs.
 *
 * `src/proxy.ts` already turns anonymous requests away, but it is matched by
 * path pattern; this check runs inside the render itself, so it holds no
 * matter how the request arrived. Route handlers and server actions do not
 * use this (a redirect is the wrong answer to an API caller) — they call
 * `auth()` and answer 401 themselves.
 */
export async function requireSession(returnTo = "/"): Promise<Session> {
  const session = await auth();
  if (!session) {
    const query = returnTo === "/" ? "" : `?callbackUrl=${encodeURIComponent(returnTo)}`;
    redirect(`/login${query}`);
  }
  return session;
}
