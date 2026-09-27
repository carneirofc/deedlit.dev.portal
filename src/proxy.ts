import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildContentSecurityPolicy, createNonce } from "@/lib/csp";

/**
 * Next 16 renamed `middleware.ts` to `proxy.ts` and moved it onto the Node
 * runtime. Three jobs here, all cheap:
 *
 *  1. Block direct browsing of `/images/` (images are served through the
 *     `/image` route, which strips PNG metadata first).
 *  2. Security headers, including a per-request CSP nonce (`src/lib/csp.ts`).
 *     The policy travels on the *request* as well as the response: Next
 *     parses the nonce out of the request's `Content-Security-Policy` header
 *     and stamps it onto its own framework and RSC scripts, and the root
 *     layout reads `x-nonce` for its inline theme script. The browser enforces
 *     the response copy. Without the request copy, `'strict-dynamic'` blocks
 *     hydration and every client component is dead.
 *  3. An *optimistic* redirect of anonymous traffic away from `/portal`.
 *     This is UX, not security — `src/app/portal/layout.tsx` re-checks the
 *     session server-side, and that check is the real boundary.
 */

const PROTECTED_PREFIX = "/portal";

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
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload"
} as const;

export const proxy = auth((request) => {
  const { pathname } = request.nextUrl;

  // Direct access to the raw image directory stays closed.
  if (pathname.startsWith("/images/")) {
    return new NextResponse("Not found", { status: 404 });
  }

  const nonce = createNonce();
  const csp = buildContentSecurityPolicy(nonce);

  const applyHeaders = (response: NextResponse) => {
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
      response.headers.set(key, value);
    }
    response.headers.set("Content-Security-Policy", csp);
    return response;
  };

  if (!request.auth && pathname.startsWith(PROTECTED_PREFIX)) {
    const loginUrl = new URL("/login", request.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", pathname);
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
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sw.js|manifest).*)"]
};
