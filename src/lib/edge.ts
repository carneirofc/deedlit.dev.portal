/**
 * Which network path a request took, and whether this deployment accepts it.
 *
 * The portal is meant to be reached over the WireGuard tunnel only. That is
 * declared in the infra repo (`ingress.public: false`) and enforced at the edge
 * by the Cloudflare Tunnel having no route for this hostname. But the edge is
 * configuration held somewhere else, applied by a different tool, and it can
 * lag the repo or be re-added by mistake. This module makes the app enforce
 * the same rule itself, so a stray tunnel route degrades to a 404 instead of
 * a public login page.
 *
 * How a request is recognised as coming through Cloudflare: the edge stamps
 * every proxied request with `CF-Connecting-IP` and `CF-Ray`, and appends
 * `cloudflare` to `CDN-Loop`. A visitor cannot remove these, because Cloudflare
 * overwrites them, and cloudflared passes them through to Traefik unchanged.
 * Someone on the WireGuard path *can* add them, but that only gets their own
 * request refused. The check can only fail closed.
 */

/**
 * Opt-in for a deployment that really is public (served through the tunnel on
 * purpose). Anything other than the exact string `true` means WireGuard only.
 */
export function allowsPublicEdge(): boolean {
  return process.env.PORTAL_ALLOW_PUBLIC_EDGE?.trim().toLowerCase() === "true";
}

export function arrivedViaCloudflare(requestHeaders: Headers): boolean {
  if (requestHeaders.has("cf-connecting-ip") || requestHeaders.has("cf-ray")) return true;
  return /\bcloudflare\b/i.test(requestHeaders.get("cdn-loop") ?? "");
}

/** True when the request must be turned away before any other work happens. */
export function isRefusedEdgeRequest(requestHeaders: Headers): boolean {
  return !allowsPublicEdge() && arrivedViaCloudflare(requestHeaders);
}
