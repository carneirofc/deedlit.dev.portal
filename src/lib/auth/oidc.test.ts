import { beforeEach, describe, expect, it, vi } from "vitest";
import { authorizeOidc, authorizeOidcIdentity, isUsableIssuer, oidcIdentity } from "./oidc";

const RULES = [
  "AUTH_ALLOWED_OIDC_SUBJECTS",
  "AUTH_ALLOWED_OIDC_EMAILS",
  "AUTH_ALLOWED_OIDC_DOMAINS",
  "AUTH_ALLOWED_OIDC_GROUPS",
  "AUTH_OIDC_GROUPS_CLAIM"
];

beforeEach(() => {
  for (const name of RULES) vi.stubEnv(name, "");
});

describe("authorizeOidc", () => {
  it("denies everyone when no allow-list rule is set", () => {
    expect(authorizeOidc({ sub: "u1", email: "a@x.dev", email_verified: true })).toBe(false);
  });

  it("denies an identity without a sub", () => {
    vi.stubEnv("AUTH_ALLOWED_OIDC_EMAILS", "a@x.dev");
    expect(authorizeOidc({ email: "a@x.dev", email_verified: true })).toBe(false);
  });

  it("matches on subject", () => {
    vi.stubEnv("AUTH_ALLOWED_OIDC_SUBJECTS", "u1");
    expect(authorizeOidc({ sub: "u1" })).toBe(true);
    expect(authorizeOidc({ sub: "u2" })).toBe(false);
  });

  it.each([
    ["missing", undefined],
    ["false", false],
    ['"false"', "false"]
  ])("never matches email or domain rules when email_verified is %s", (_label, verified) => {
    vi.stubEnv("AUTH_ALLOWED_OIDC_EMAILS", "a@x.dev");
    vi.stubEnv("AUTH_ALLOWED_OIDC_DOMAINS", "x.dev");
    expect(authorizeOidc({ sub: "u1", email: "a@x.dev", email_verified: verified })).toBe(false);
  });

  it('accepts email_verified as true or "true"', () => {
    vi.stubEnv("AUTH_ALLOWED_OIDC_EMAILS", "a@x.dev");
    expect(authorizeOidc({ sub: "u1", email: "A@x.dev", email_verified: true })).toBe(true);
    expect(authorizeOidc({ sub: "u1", email: "a@x.dev", email_verified: "true" })).toBe(true);
  });

  it("normalises an @-prefixed domain rule", () => {
    vi.stubEnv("AUTH_ALLOWED_OIDC_DOMAINS", "@x.dev");
    expect(authorizeOidc({ sub: "u1", email: "b@x.dev", email_verified: true })).toBe(true);
    expect(authorizeOidc({ sub: "u1", email: "b@evilx.dev", email_verified: true })).toBe(false);
  });

  it.each([
    ["an array", ["Ops", "admins"]],
    ["a space-delimited string", "ops admins"],
    ["a comma-delimited string", "ops,admins"]
  ])("reads groups from %s", (_label, groups) => {
    vi.stubEnv("AUTH_ALLOWED_OIDC_GROUPS", "admins");
    expect(authorizeOidc({ sub: "u1", groups })).toBe(true);
  });
});

describe("oidcIdentity group limits apply the same at sign-in and re-check", () => {
  it("drops over-long groups and anything after the 32nd", () => {
    vi.stubEnv("AUTH_ALLOWED_OIDC_GROUPS", "late,long");

    const many = Array.from({ length: 32 }, (_, i) => `g${i}`);
    const identity = oidcIdentity({ sub: "u1", groups: [...many, "late", "x".repeat(97)] });

    expect(identity.groups).toHaveLength(32);
    expect(identity.groups).not.toContain("late");
    expect(authorizeOidcIdentity(identity)).toBe(false);
    expect(authorizeOidc({ sub: "u1", groups: [...many, "late"] })).toBe(false);
  });
});

describe("isUsableIssuer", () => {
  it.each([
    ["https://idp.example", true],
    ["http://localhost:8080/realms/x", true],
    ["http://127.0.0.1:8080", true],
    ["http://[::1]:8080", true],
    ["http://idp.example", false],
    // Only the exact loopback names are admitted; the rest of 127/8 is refused.
    ["http://127.0.0.2", false],
    ["not a url", false]
  ])("%s → %s", (issuer, usable) => {
    expect(isUsableIssuer(issuer)).toBe(usable);
  });
});
