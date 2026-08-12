import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // The portal is behind authentication; keep it out of the index so its
      // hostnames never surface in search results.
      disallow: ["/portal", "/login", "/api/"]
    },
    sitemap: "https://deedlit.dev/sitemap.xml"
  };
}
