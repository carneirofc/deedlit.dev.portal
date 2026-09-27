/**
 * The site's Content-Security-Policy, built per request around a fresh nonce.
 *
 * Kept apart from `src/proxy.ts` so the policy itself can be unit-tested; the
 * proxy only decides where it is attached.
 */

/**
 * 128 random bits, base64-encoded. A UUID is valid nonce syntax too, but
 * base64 is the grammar the CSP spec and the Next.js guide both use.
 */
export function createNonce(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");
}

export function buildContentSecurityPolicy(
  nonce: string,
  { isDev = process.env.NODE_ENV !== "production" }: { isDev?: boolean } = {}
): string {
  return [
    "default-src 'self'",
    // `strict-dynamic` lets the nonced Next bootstrap load its own chunks, and
    // makes CSP3 browsers ignore `'self'` — so every framework script has to
    // carry the nonce. Next stamps it on them when it finds this policy on the
    // *request* (see `src/proxy.ts`).
    // Dev additionally needs `unsafe-eval` for hot module replacement.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Next injects inline <style> for fonts and critical CSS, and there is no
    // nonce hook for those, so styles stay permissive while scripts do not.
    "style-src 'self' 'unsafe-inline'",
    // No third-party image origin: every allowed origin is one more place an
    // injection could exfiltrate to, and nothing renders a remote avatar.
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"])
  ].join("; ");
}
