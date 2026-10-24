import { describe, expect, it } from "vitest";
import { isApiPath, isPublicPath } from "@/lib/public-paths";

describe("isPublicPath", () => {
  it.each([
    "/login",
    "/api/health",
    "/robots.txt",
    "/api/auth/providers",
    "/api/auth/callback/github",
    "/api/auth/session"
  ])("admits %s", (path) => {
    expect(isPublicPath(path)).toBe(true);
  });

  it.each([
    "/",
    "/account",
    "/portal",
    "/api/portal/services",
    "/api/healthz",
    "/api/health/x",
    "/api/auth",
    "/api/authx/session",
    "/login/x",
    "/loginx",
    "/manifest.webmanifest",
    "/sitemap.xml"
  ])("requires a session for %s", (path) => {
    expect(isPublicPath(path)).toBe(false);
  });
});

describe("isApiPath", () => {
  it("matches the api tree only", () => {
    expect(isApiPath("/api")).toBe(true);
    expect(isApiPath("/api/portal/services")).toBe(true);
    expect(isApiPath("/apis")).toBe(false);
    expect(isApiPath("/")).toBe(false);
  });
});
