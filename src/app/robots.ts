import type { MetadataRoute } from "next";

/**
 * Nothing here is for crawlers: every page is behind a session and the host
 * is WireGuard-only. Public so a well-behaved bot gets an answer instead of a
 * login redirect; `X-Robots-Tag` (src/proxy.ts) says the same on every route.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", disallow: "/" }
  };
}
