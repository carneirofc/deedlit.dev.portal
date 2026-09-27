import { describe, expect, it } from "vitest";
import { isValidDnsLabel, parseHealthPath, parsePort } from "./discover";

describe("annotation parsers", () => {
  it.each(["//x", "/../x", "http://x", "/a b", "/a#b", "x", "/a\\b"])(
    "parseHealthPath rejects %s back to /",
    (raw) => {
      expect(parseHealthPath(raw)).toBe("/");
    }
  );

  it("parseHealthPath accepts a simple path with a query", () => {
    expect(parseHealthPath("/healthz?full=1")).toBe("/healthz?full=1");
  });

  it.each(["0", "65536", "80abc", "-1", "8.5", " 80", ""])("parsePort rejects %j", (raw) => {
    expect(parsePort(raw, undefined)).toBeUndefined();
  });

  it("parsePort accepts a port and otherwise keeps the fallback", () => {
    expect(parsePort("9000", 80)).toBe(9000);
    expect(parsePort("nope", 80)).toBe(80);
  });

  it("isValidDnsLabel follows RFC 1123", () => {
    expect(isValidDnsLabel("my-svc")).toBe(true);
    expect(isValidDnsLabel("-bad")).toBe(false);
    expect(isValidDnsLabel("a.b")).toBe(false);
    expect(isValidDnsLabel("a".repeat(64))).toBe(false);
  });
});
