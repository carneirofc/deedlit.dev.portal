import { afterEach, describe, expect, it, vi } from "vitest";
import { allowsPublicEdge, arrivedViaCloudflare, isRefusedEdgeRequest } from "./edge";

const headers = (entries: Record<string, string>) => new Headers(entries);

describe("arrivedViaCloudflare", () => {
  it("recognises each header the Cloudflare edge stamps", () => {
    expect(arrivedViaCloudflare(headers({ "cf-connecting-ip": "203.0.113.7" }))).toBe(true);
    expect(arrivedViaCloudflare(headers({ "cf-ray": "8f00000000000000-GRU" }))).toBe(true);
    expect(arrivedViaCloudflare(headers({ "cdn-loop": "cloudflare; loops=1" }))).toBe(true);
    expect(arrivedViaCloudflare(headers({ "cdn-loop": "Fastly, cloudflare" }))).toBe(true);
  });

  it("treats a request with none of them as the WireGuard path", () => {
    expect(arrivedViaCloudflare(headers({ "x-forwarded-for": "10.42.0.9" }))).toBe(false);
    expect(arrivedViaCloudflare(headers({ "cdn-loop": "akamai" }))).toBe(false);
  });
});

describe("isRefusedEdgeRequest", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("refuses edge traffic by default", () => {
    vi.stubEnv("PORTAL_ALLOW_PUBLIC_EDGE", "");
    expect(allowsPublicEdge()).toBe(false);
    expect(isRefusedEdgeRequest(headers({ "cf-ray": "x" }))).toBe(true);
    expect(isRefusedEdgeRequest(headers({}))).toBe(false);
  });

  it("only the exact opt-in admits it", () => {
    for (const value of ["1", "yes", "on", "truthy"]) {
      vi.stubEnv("PORTAL_ALLOW_PUBLIC_EDGE", value);
      expect(isRefusedEdgeRequest(headers({ "cf-ray": "x" }))).toBe(true);
    }

    vi.stubEnv("PORTAL_ALLOW_PUBLIC_EDGE", " TRUE ");
    expect(isRefusedEdgeRequest(headers({ "cf-ray": "x" }))).toBe(false);
  });
});
