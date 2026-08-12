import GitHub from "next-auth/providers/github";
import type { Provider } from "next-auth/providers";
import { logger } from "@/lib/logger";

/**
 * The GitHub sign-in path for the portal.
 *
 * GitHub tells us *who* someone is; the org/team membership check here decides
 * whether they get in at all. Every failure path returns false, so a broken
 * config locks everyone out rather than letting everyone in.
 */

export const GITHUB_PROVIDER_ID = "github";

const GITHUB_API = "https://api.github.com";
const GITHUB_API_TIMEOUT_MS = 5_000;

const env = (name: string) => process.env[name]?.trim() ?? "";

const allowedOrg = () => env("AUTH_ALLOWED_GITHUB_ORG");
const allowedTeam = () => env("AUTH_ALLOWED_GITHUB_TEAM");

const allowedUsers = () =>
  env("AUTH_ALLOWED_GITHUB_USERS")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

/** A provider is offered only when it is fully configured — see `oidc.ts`. */
export function isGitHubConfigured(): boolean {
  return Boolean(env("AUTH_GITHUB_ID") && env("AUTH_GITHUB_SECRET"));
}

export function githubProvider(): Provider {
  return GitHub({
    // `read:org` is what makes the membership lookup below possible;
    // the default scope cannot see org membership at all.
    authorization: { params: { scope: "read:user user:email read:org" } }
  });
}

async function githubGet(path: string, token: string): Promise<Response> {
  return fetch(`${GITHUB_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS),
    cache: "no-store"
  });
}

/**
 * True when the user is an *active* member of the configured org. Uses the
 * `/user/memberships` endpoint rather than `/orgs/{org}/members/{user}`
 * because it reports private memberships too — a member whose membership is
 * concealed should still be able to sign in.
 */
async function isActiveOrgMember(org: string, token: string): Promise<boolean> {
  const response = await githubGet(`/user/memberships/orgs/${encodeURIComponent(org)}`, token);
  if (!response.ok) return false;

  const membership = (await response.json()) as { state?: string };
  return membership.state === "active";
}

async function isActiveTeamMember(
  org: string,
  team: string,
  login: string,
  token: string
): Promise<boolean> {
  const response = await githubGet(
    `/orgs/${encodeURIComponent(org)}/teams/${encodeURIComponent(team)}/memberships/${encodeURIComponent(login)}`,
    token
  );
  if (!response.ok) return false;

  const membership = (await response.json()) as { state?: string };
  return membership.state === "active";
}

/**
 * Decides whether a freshly authenticated GitHub user may use the portal.
 *
 * Fails closed: every failure path — no token, no rule configured, API error,
 * timeout, inactive membership — returns false.
 */
async function isAuthorized(login: string, token: string | undefined): Promise<boolean> {
  const normalizedLogin = login.toLowerCase();

  if (allowedUsers().includes(normalizedLogin)) return true;

  const org = allowedOrg();
  if (!org) return false;

  if (!token) {
    logger.warn("Portal sign-in denied: GitHub returned no access token", { login });
    return false;
  }

  try {
    if (!(await isActiveOrgMember(org, token))) return false;

    const team = allowedTeam();
    if (team) return await isActiveTeamMember(org, team, login, token);

    return true;
  } catch (error) {
    logger.error("Portal sign-in denied: GitHub membership check failed", {
      login,
      reason: error instanceof Error ? error.message : "unknown error"
    });
    return false;
  }
}

/** The GitHub login, which is also what the portal shows as the username. */
export function githubUsername(profile: Record<string, unknown> | undefined): string {
  return typeof profile?.login === "string" ? profile.login : "";
}

/**
 * GitHub's numeric account id. Unlike the login it cannot be changed or, once
 * freed, re-registered by someone else, so it is what identifies the session.
 */
export function githubSubject(profile: Record<string, unknown> | undefined): string {
  const id = profile?.id;
  if (typeof id === "number" && Number.isFinite(id)) return String(id);
  if (typeof id === "string" && id.trim()) return id.trim();
  return "";
}

/**
 * Re-checks an existing session against the *current* configuration, without
 * calling GitHub.
 *
 * The access token is deliberately not kept (see `src/auth.ts`), so org and
 * team membership cannot be re-verified here — that check happens once, at
 * sign-in, and its result is bounded by the session lifetime. What can be
 * re-checked is local and still worth it: an explicit allow-list entry that
 * has since been removed, and a configuration that has lost its rules
 * entirely. Both revoke at the user's next request rather than in eight hours.
 */
export function reauthorizeGitHub(login: string): boolean {
  if (!login) return false;
  if (allowedUsers().includes(login.toLowerCase())) return true;

  // Admitted via org membership: re-verifying needs a credential this app
  // refuses to store, so the sign-in decision stands for the session.
  if (allowedOrg()) return true;

  logger.warn("Portal access denied: no GitHub allow-list rule remains for this session", {
    login
  });
  return false;
}

export async function authorizeGitHub(
  profile: Record<string, unknown> | undefined,
  accessToken: string | undefined
): Promise<boolean> {
  const login = githubUsername(profile);
  if (!login) return false;

  const authorized = await isAuthorized(login, accessToken);
  if (!authorized) {
    logger.warn("Portal sign-in denied: not an authorized GitHub member", { login });
  }

  return authorized;
}
