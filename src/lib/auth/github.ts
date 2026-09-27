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

function isAllowListedUser(login: string): boolean {
  return allowedUsers().includes(login.toLowerCase());
}

/**
 * *Which* rule admitted a session — evidence, not a verdict. Stored in the JWT
 * and re-evaluated against the current configuration on every request, so an
 * org switch, an added team restriction or a removed allow-list entry revokes
 * the sessions it no longer covers. Never collapse this into a boolean.
 */
export type GitHubGrant = { via: "user" } | { via: "org"; org: string; team?: string };

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
 * Decides whether a freshly authenticated GitHub user may use the portal, and
 * on what basis.
 *
 * Fails closed: every failure path — no token, no rule configured, API error,
 * timeout, inactive membership — returns null. The user allow-list is checked
 * first, so someone in both gets `via: "user"` — the rule that survives an org
 * change.
 */
async function grantFor(
  login: string,
  token: string | undefined
): Promise<GitHubGrant | null> {
  if (isAllowListedUser(login)) return { via: "user" };

  const org = allowedOrg();
  if (!org) return null;

  if (!token) {
    logger.warn("Portal sign-in denied: GitHub returned no access token", { login });
    return null;
  }

  try {
    if (!(await isActiveOrgMember(org, token))) return null;

    const team = allowedTeam();
    if (team) {
      return (await isActiveTeamMember(org, team, login, token)) ? { via: "org", org, team } : null;
    }

    return { via: "org", org };
  } catch (error) {
    logger.error("Portal sign-in denied: GitHub membership check failed", {
      login,
      reason: error instanceof Error ? error.message : "unknown error"
    });
    return null;
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
 * team *membership* cannot be re-verified here — that stands for the session
 * lifetime. Everything else is re-checked, because the grant records which
 * rule admitted the session and that rule must still exist:
 *
 * - `via: "user"`: the login must still be on the allow-list.
 *   Configuring an org does not keep a removed user in.
 * - `via: "org"`: the configured org must be the one that admitted them, and
 *   a team restriction, if one is configured now, must be the team they were
 *   admitted through. Removing a team restriction broadens the rule, so
 *   team-granted sessions stay valid.
 *
 * A token without a grant (issued before grants existed) is refused, which
 * costs one re-login and fails closed.
 */
export function reauthorizeGitHub(
  identity: { login: string; subject: string },
  grant: GitHubGrant | undefined
): boolean {
  const { login } = identity;
  if (!login || !grant) return deny(login, "no sign-in grant recorded");

  if (grant.via === "user") {
    return isAllowListedUser(login) || deny(login, "removed from the user allow-list");
  }

  const org = allowedOrg().toLowerCase();
  if (!org || grant.org.toLowerCase() !== org) return deny(login, "org rule changed");

  const team = allowedTeam().toLowerCase();
  if (team && grant.team?.toLowerCase() !== team) return deny(login, "team rule changed");

  return true;
}

function deny(login: string, reason: string): false {
  logger.warn("Portal access denied: GitHub session no longer matches a rule", {
    login: login || "(none)",
    reason
  });
  return false;
}

/**
 * The sign-in decision. Returns the grant that admitted the user, or null.
 * Network calls to GitHub when an org rule is configured.
 */
export async function authorizeGitHub(
  profile: Record<string, unknown> | undefined,
  accessToken: string | undefined
): Promise<GitHubGrant | null> {
  const login = githubUsername(profile);
  if (!login) return null;

  const grant = await grantFor(login, accessToken);
  if (!grant) {
    logger.warn("Portal sign-in denied: not an authorized GitHub member", { login });
  }

  return grant;
}
