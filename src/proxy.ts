import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildContentSecurityPolicy, createNonce } from "@/lib/csp";
import { isApiPath, isPublicPath } from "@/lib/public-paths";

/**
 * Next 16 renamed `middleware.ts` to `proxy.ts` and moved it onto the Node
 * runtime. Two jobs here:
 *
 *  1. Deny by default. Every route except the short allow-list in
 *     `src/lib/public-paths.ts` needs a session: anonymous page requests are
 *     sent to `/login`, anonymous API requests get a 401. This is the first
 *     gate, not the only one — the `(portal)` layout and every route handler
 *     and server action re-check the session server-side, so a matcher
 *     mistake here degrades to a refusal one layer later, never to an open
 *     route.
 *  2. Security headers, including a per-request CSP nonce (`src/lib/csp.ts`).
 *     The policy travels on the *request* as well as the response: Next
 *     parses the nonce out of the request's `Content-Security-Policy` header
 *     and stamps it onto its own framework and RSC scripts, and the root
 *     layout reads `x-nonce` for its inline theme script. The browser enforces
 *     the response copy. Without the request copy, `'strict-dynamic'` blocks
 *     hydration and every client component is dead.
 */

const SECURITY_HEADERS = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  // Deliberately 0, not "1; mode=block". The legacy auditor is retired in every
  // current browser, and where it survives its selective-blocking heuristics
  // have themselves been used to leak cross-origin data. The CSP is the
  // real defence; switching the auditor off is the vendor-recommended pairing.
  "X-XSS-Protection": "0",
  // A service card opens its target in a new tab. This keeps that tab in its
  // own browsing-context group, so it holds no window handle back to a page
  // that renders an authenticated session.
  "Cross-Origin-Opener-Policy": "same-origin",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  // Nothing on this host belongs in a search index, public routes included.
  "X-Robots-Tag": "noindex, nofollow"
} as const;

export const proxy = auth((request) => {
  const { pathname, search } = request.nextUrl;

  const nonce = createNonce();
  const csp = buildContentSecurityPolicy(nonce);

  const applyHeaders = (response: NextResponse) => {
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
      response.headers.set(key, value);
    }
    response.headers.set("Content-Security-Policy", csp);
    return response;
  };

  if (!request.auth && !isPublicPath(pathname)) {
    if (isApiPath(pathname)) {
      return applyHeaders(
        NextResponse.json(
          { error: "Unauthorized" },
          { status: 401, headers: { "Cache-Control": "no-store" } }
        )
      );
    }

    // `/login` re-validates this with `safeCallbackUrl()` before using it.
    const loginUrl = new URL("/login", request.nextUrl.origin);
    if (pathname !== "/") loginUrl.searchParams.set("callbackUrl", `${pathname}${search}`);
    return applyHeaders(NextResponse.redirect(loginUrl));
  }

  // The nonce rides inbound so the root layout can stamp it onto its inline
  // theme script; it also has to be on the response for the browser to honour.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Next parses the nonce out of the *request* CSP header and stamps it onto
  // its own framework scripts; without this, 'strict-dynamic' blocks hydration.
  requestHeaders.set("Content-Security-Policy", csp);

  return applyHeaders(NextResponse.next({ request: { headers: requestHeaders } }));
});

export const config = {
  // Everything except hashed static bundles (client code, never data), the app
  // icon, and the service-worker kill switch — `public/sw.js` has to stay
  // fetchable without a session, or a browser that installed the old worker
  // can never replace it.
  matcher: ["/((?!_next/static/|icon\\.svg|favicon\\.ico|sw\\.js).*)"]
};
