import { describe, expect, it } from "vitest";
import { isProbeTargetAllowed } from "./health";

describe("isProbeTargetAllowed", () => {
  it.each([
    ["https://a.b.svc.cluster.local/", false],
    ["http://a.b.svc.cluster.local.evil.example/", false],
    ["http://user:pw@a.b.svc.cluster.local/", false],
    ["http://a.svc.cluster.local/", false],
    ["http://a.b.c.svc.cluster.local/", false],
    ["http://169.254.169.254/latest/meta-data", false],
    ["not a url", false],
    ["http://a.b.svc.cluster.local:9000/x", true]
  ])("%s → %s", (url, allowed) => {
    expect(isProbeTargetAllowed(url)).toBe(allowed);
  });
});
