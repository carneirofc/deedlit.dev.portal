import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  authorizeGitHub,
  type GitHubGrant,
  parseGitHubUserRule,
  reauthorizeGitHub
} from "./github";

const identity = (login: string, subject = "42") => ({ login, subject });

beforeEach(() => {
  vi.stubEnv("AUTH_ALLOWED_GITHUB_ORG", "");
  vi.stubEnv("AUTH_ALLOWED_GITHUB_TEAM", "");
  vi.stubEnv("AUTH_ALLOWED_GITHUB_USERS", "");
});

describe("reauthorizeGitHub — the grant must still be backed by config", () => {
  const org: GitHubGrant = { via: "org", org: "acme" };
  const team: GitHubGrant = { via: "org", org: "acme", team: "platform" };

  it("revokes an org grant when the org changes", () => {
    vi.stubEnv("AUTH_ALLOWED_GITHUB_ORG", "other-org");
    expect(reauthorizeGitHub(identity("alice"), org)).toBe(false);
  });

  it("revokes an org grant when a team restriction is added", () => {
    vi.stubEnv("AUTH_ALLOWED_GITHUB_ORG", "acme");
    vi.stubEnv("AUTH_ALLOWED_GITHUB_TEAM", "platform");
    expect(reauthorizeGitHub(identity("alice"), org)).toBe(false);
  });

  it("revokes a team grant when the team changes", () => {
    vi.stubEnv("AUTH_ALLOWED_GITHUB_ORG", "acme");
    vi.stubEnv("AUTH_ALLOWED_GITHUB_TEAM", "admins");
    expect(reauthorizeGitHub(identity("alice"), team)).toBe(false);
  });

  it("keeps a team grant when the team restriction is removed (the rule broadened)", () => {
    vi.stubEnv("AUTH_ALLOWED_GITHUB_ORG", "acme");
    expect(reauthorizeGitHub(identity("alice"), team)).toBe(true);
  });

  it("keeps an org grant while the org rule is unchanged, case-insensitively", () => {
    vi.stubEnv("AUTH_ALLOWED_GITHUB_ORG", "ACME");
    expect(reauthorizeGitHub(identity("alice"), org)).toBe(true);
  });

  it("revokes a user grant removed from the list even though an org is configured", () => {
    vi.stubEnv("AUTH_ALLOWED_GITHUB_ORG", "acme");
    vi.stubEnv("AUTH_ALLOWED_GITHUB_USERS", "bob");
    expect(reauthorizeGitHub(identity("alice"), { via: "user" })).toBe(false);
  });

  it("revokes a token issued before grants existed", () => {
    vi.stubEnv("AUTH_ALLOWED_GITHUB_ORG", "acme");
    vi.stubEnv("AUTH_ALLOWED_GITHUB_USERS", "alice");
    expect(reauthorizeGitHub(identity("alice"), undefined)).toBe(false);
  });

  it("re-checks a user grant against the pinned id", () => {
    vi.stubEnv("AUTH_ALLOWED_GITHUB_USERS", "alice:42");
    expect(reauthorizeGitHub(identity("alice", "42"), { via: "user" })).toBe(true);
    expect(reauthorizeGitHub(identity("alice", "99"), { via: "user" })).toBe(false);
  });
});

describe("AUTH_ALLOWED_GITHUB_USERS entries", () => {
  it("parses login:id, id-only and legacy login entries", () => {
    expect(parseGitHubUserRule(" CarneiroFC:42 ")).toEqual({ login: "carneirofc", id: "42" });
    expect(parseGitHubUserRule("42")).toEqual({ id: "42" });
    expect(parseGitHubUserRule("carneirofc")).toEqual({ login: "carneirofc" });
  });

  it("drops shapes it does not recognise instead of half-matching them", () => {
    expect(parseGitHubUserRule("alice:")).toBeNull();
    expect(parseGitHubUserRule(":42")).toBeNull();
    expect(parseGitHubUserRule("a*")).toBeNull();
    expect(parseGitHubUserRule("")).toBeNull();
  });

  const profile = (login: string, id: number) => ({ login, id });

  it("requires both parts of login:id to match", async () => {
    vi.stubEnv("AUTH_ALLOWED_GITHUB_USERS", "carneirofc:42");

    expect(await authorizeGitHub(profile("carneirofc", 42), undefined)).toEqual({ via: "user" });
    // A re-registered login: same name, new account.
    expect(await authorizeGitHub(profile("carneirofc", 99), undefined)).toBeNull();
    expect(await authorizeGitHub(profile("other", 42), undefined)).toBeNull();
  });

  it("matches an id-only entry whatever the login", async () => {
    vi.stubEnv("AUTH_ALLOWED_GITHUB_USERS", "42");
    expect(await authorizeGitHub(profile("anything", 42), undefined)).toEqual({ via: "user" });
  });

  it("still accepts a legacy login entry", async () => {
    vi.stubEnv("AUTH_ALLOWED_GITHUB_USERS", "carneirofc");
    expect(await authorizeGitHub(profile("CarneiroFC", 7), undefined)).toEqual({ via: "user" });
  });
});

describe("authorizeGitHub — org membership", () => {
  const profile = { login: "alice", id: 7 };

  function mockGitHub(membership: () => Promise<Response>) {
    const fetchMock = vi.fn(membership);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  beforeEach(() => vi.stubEnv("AUTH_ALLOWED_GITHUB_ORG", "acme"));

  it("admits an active member with an org grant", async () => {
    mockGitHub(async () => Response.json({ state: "active" }));
    expect(await authorizeGitHub(profile, "token")).toEqual({ via: "org", org: "acme" });
  });

  it("records the team when a team restriction admitted the user", async () => {
    vi.stubEnv("AUTH_ALLOWED_GITHUB_TEAM", "platform");
    mockGitHub(async () => Response.json({ state: "active" }));
    expect(await authorizeGitHub(profile, "token")).toEqual({
      via: "org",
      org: "acme",
      team: "platform"
    });
  });

  it.each([
    ["a pending membership", async () => Response.json({ state: "pending" })],
    ["a 404", async () => new Response("", { status: 404 })],
    ["a timeout", async () => Promise.reject(new DOMException("timed out", "TimeoutError"))],
    ["a thrown error", async () => Promise.reject(new Error("boom"))]
  ])("denies on %s", async (_label, membership) => {
    mockGitHub(membership);
    expect(await authorizeGitHub(profile, "token")).toBeNull();
  });

  it("denies without an access token and never calls GitHub", async () => {
    const fetchMock = mockGitHub(async () => Response.json({ state: "active" }));
    expect(await authorizeGitHub(profile, undefined)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("denies when no rule is configured at all", async () => {
    vi.stubEnv("AUTH_ALLOWED_GITHUB_ORG", "");
    expect(await authorizeGitHub(profile, "token")).toBeNull();
  });
});
