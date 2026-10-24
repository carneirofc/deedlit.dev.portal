/**
 * The complete list of routes an anonymous client may reach.
 *
 * Everything else — every page, every route handler, every server action —
 * requires a session. The list is an allow-list on purpose: a route added
 * later is private until someone deliberately makes it public here, rather
 * than public until someone remembers to protect it.
 *
 * Not listed because `src/proxy.ts` never sees them (see its `matcher`):
 * `/_next/static/*` (hashed framework/client bundles — code, never data),
 * `/icon.svg` and `/sw.js`.
 */

/** Exact paths. */
const PUBLIC_PATHS: ReadonlySet<string> = new Set([
  // The sign-in page itself, and the server action it posts back to.
  "/login",
  // Kubelet liveness/readiness and the portal's own self-probe. Dependency-free.
  "/api/health",
  "/robots.txt"
]);

/** Prefixes, each ending in `/` so `/api/authx` cannot ride along. */
const PUBLIC_PREFIXES: readonly string[] = [
  // Auth.js: providers, csrf, signin, callback, session, signout. It does its
  // own CSRF and state checks; sign-in and callbacks are rate-limited in the
  // route handler.
  "/api/auth/"
];

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/** Route handlers answer an anonymous caller with 401, not a login redirect. */
export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}
