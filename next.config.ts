import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Don't advertise the framework. Everything else security-header shaped
  // lives in src/proxy.ts, where the per-request CSP nonce is generated.
  poweredByHeader: false,
  output: "standalone",
  async redirects() {
    // The dashboard used to live at /portal; it is the whole app now. Kept so
    // bookmarks and the old login callback keep working. The target is still
    // behind the proxy's session check.
    return [
      { source: "/portal", destination: "/", permanent: true },
      { source: "/portal/:path*", destination: "/", permanent: true }
    ];
  }
};

export default nextConfig;
