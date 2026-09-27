import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy, createNonce } from "./csp";

function directive(policy: string, name: string): string {
  return policy.split("; ").find((entry) => entry.startsWith(`${name} `)) ?? "";
}

describe("buildContentSecurityPolicy", () => {
  it("never allows inline or eval'd script in production", () => {
    const scripts = directive(buildContentSecurityPolicy("abc", { isDev: false }), "script-src");

    expect(scripts).toContain("'nonce-abc'");
    expect(scripts).toContain("'strict-dynamic'");
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts).not.toContain("'unsafe-eval'");
  });

  it("adds unsafe-eval only in dev", () => {
    expect(directive(buildContentSecurityPolicy("abc", { isDev: true }), "script-src")).toContain(
      "'unsafe-eval'"
    );
  });

  it("locks down framing, plugins, base and form targets", () => {
    const policy = buildContentSecurityPolicy("abc", { isDev: false });

    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("form-action 'self'");
    expect(directive(policy, "img-src")).not.toMatch(/https:/);
  });
});

describe("createNonce", () => {
  it("is base64 of 128 bits and unique per call", () => {
    const nonce = createNonce();

    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(createNonce()).not.toBe(nonce);
  });
});
