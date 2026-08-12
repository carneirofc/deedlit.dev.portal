import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Don't advertise the framework. Everything else security-header shaped
  // lives in src/proxy.ts, where the per-request CSP nonce is generated.
  poweredByHeader: false,
  output: 'standalone',
  // Image optimization (resize + WebP/AVIF) is left to Next's built-in
  // optimizer. The /image?id=… route is a same-origin local path, so the
  // default loader serves resized variants via /_next/image and caches them.
  // Next 16 requires query-string local sources to be whitelisted; `search`
  // is omitted so any ?id=… is allowed.
  images: {
    localPatterns: [{ pathname: "/image" }],
  },
};

export default nextConfig;

