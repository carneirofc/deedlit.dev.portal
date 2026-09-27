/**
 * Return-URL validation.
 *
 * A return URL arrives in the query string, so it is attacker-controlled: a
 * link to `/login?callbackUrl=https://evil.example` would otherwise bounce an
 * already-signed-in user straight off the origin, with the portal's own
 * hostname lending the hop credibility.
 *
 * Prefix tests on the raw string are not enough. The WHATWG URL parser strips
 * tab, LF and CR anywhere in the input and reads `\` as `/`, so `/\t/evil.example`
 * passes "starts with one slash" and still resolves to `//evil.example` in the
 * browser. The input is therefore judged the way a browser would judge it —
 * parsed against an origin — and only the re-serialised result is returned, so
 * the value that reaches `redirect()` is the one that was checked.
 */

export const CALLBACK_FALLBACK = "/portal";

/** A fixed, never-resolving origin to resolve candidates against. */
const PROBE_ORIGIN = "http://callback.invalid";

const MAX_LENGTH = 2048;

/**
 * Tab/LF/CR are silently dropped by browsers before parsing, other controls
 * have no business in a path, and `\` is read as `/`. Anything that needs one
 * of them is not a path a user was sent to honestly, so this is stricter than
 * the parser strictly requires — on purpose.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point
const SUSPICIOUS = /[\u0000-\u001F\u007F\\]/;

/**
 * The site-relative path `raw` resolves to, or `null` when it would leave the
 * origin, is malformed, or leans on parser normalisation to get anywhere.
 */
export function sameOriginPath(raw: string | undefined | null): string | null {
  if (!raw || raw.length > MAX_LENGTH) return null;
  if (SUSPICIOUS.test(raw)) return null;
  if (!raw.startsWith("/")) return null;

  let url: URL;
  try {
    url = new URL(raw, PROBE_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== PROBE_ORIGIN) return null;

  const path = `${url.pathname}${url.search}${url.hash}`;
  // `/%2F%2Fevil.example` is fine to the parser, but some routers decode the
  // path before redirecting. A path that *starts* like a protocol-relative URL
  // after decoding is refused rather than trusted to every hop downstream.
  if (/^\/(\/|%2f|%5c)/i.test(path)) return null;
  return path;
}

/** The only area `/login` ever legitimately returns someone to. */
function isPortalPath(path: string): boolean {
  const pathname = path.replace(/[?#].*$/, "");
  return pathname === "/portal" || pathname.startsWith("/portal/");
}

/**
 * Where `/login` sends someone after sign-in. `/login` is only ever reached
 * from the portal, so anything outside `/portal` — even same-origin — falls
 * back rather than becoming a redirect gadget.
 */
export function safeCallbackUrl(raw: string | undefined | null): string {
  const path = sameOriginPath(raw);
  return path && isPortalPath(path) ? path : CALLBACK_FALLBACK;
}

/**
 * Auth.js `callbacks.redirect`: the same rule as above, applied to every
 * redirect Auth.js performs (sign-in and sign-out), so both paths share one
 * implementation instead of relying on the library default. Same-origin only,
 * not portal-only, because sign-out legitimately lands on `/`.
 */
export function safeAuthRedirect(url: string, baseUrl: string): string {
  if (url.startsWith("/")) {
    const path = sameOriginPath(url);
    return path ? `${baseUrl}${path}` : baseUrl;
  }

  if (SUSPICIOUS.test(url)) return baseUrl;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return baseUrl;
  }
  if (parsed.origin !== new URL(baseUrl).origin) return baseUrl;

  const path = sameOriginPath(`${parsed.pathname}${parsed.search}${parsed.hash}`);
  return path ? `${baseUrl}${path}` : baseUrl;
}
