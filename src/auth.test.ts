import { beforeEach, describe, expect, it, vi } from "vitest";
import { hasUsableSecret, stillAuthorized } from "./auth";

beforeEach(() => {
  vi.stubEnv("AUTH_GITHUB_ID", "id");
  vi.stubEnv("AUTH_GITHUB_SECRET", "secret");
  vi.stubEnv("AUTH_ALLOWED_GITHUB_USERS", "alice");
  vi.stubEnv("AUTH_ALLOWED_GITHUB_ORG", "");
  vi.stubEnv("AUTH_ALLOWED_GITHUB_TEAM", "");
});

describe("stillAuthorized", () => {
  const github = { provider: "github", username: "alice", subject: "42", githubGrant: { via: "user" as const } };

  it("keeps a session whose rule still stands", () => {
    expect(stillAuthorized(github)).toBe(true);
  });

  it.each([undefined, "credentials", "email"])("rejects provider %s", (provider) => {
    expect(stillAuthorized({ ...github, provider })).toBe(false);
  });

  it("rejects once the provider's env is removed", () => {
    vi.stubEnv("AUTH_GITHUB_SECRET", "");
    expect(stillAuthorized(github)).toBe(false);
  });

  it("rejects an OIDC session when OIDC is not configured", () => {
    vi.stubEnv("AUTH_OIDC_ISSUER", "");
    expect(stillAuthorized({ provider: "oidc", subject: "u1" })).toBe(false);
  });
});

describe("hasUsableSecret", () => {
  it("needs at least 32 characters", () => {
    vi.stubEnv("AUTH_SECRET", "x".repeat(31));
    expect(hasUsableSecret()).toBe(false);

    vi.stubEnv("AUTH_SECRET", "x".repeat(32));
    expect(hasUsableSecret()).toBe(true);
  });
});
