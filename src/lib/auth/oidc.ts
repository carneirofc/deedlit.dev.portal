import type { Provider } from "next-auth/providers";
import { logger } from "@/lib/logger";

/**
 * A generic OpenID Connect sign-in path, so the portal is not tied to GitHub.
 *
 * Everything is discovery-based: given `AUTH_OIDC_ISSUER`, Auth.js fetches
 * `<issuer>/.well-known/openid-configuration` and derives the endpoints, so
 * any compliant IdP (Keycloak, Authentik, Authelia, Zitadel, Entra ID, Okta,
 * Google, …) works without provider-specific code.
 *
 * Authorization follows the same rule as GitHub: authentication says *who*,
 * the allow-lists here say *whether*, and every unclear path is a denial.
 */

export const OIDC_PROVIDER_ID = "oidc";

const DEFAULT_SCOPE = "openid profile email";
const DEFAULT_GROUPS_CLAIM = "groups";
const DEFAULT_USERNAME_CLAIM = "preferred_username";
const DEFAULT_DISPLAY_NAME = "SSO";

const env = (name: string) => process.env[name]?.trim() ?? "";

const list = (name: string) =>
  env(name)
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

/**
 * Discovery is an unauthenticated fetch whose response decides where we send
 * users and their authorization codes. Over plaintext, anyone on the path can
 * rewrite it, so `http://` issuers are refused outside loopback (where the
 * only realistic caller is a developer running an IdP locally).
 */
export function isUsableIssuer(issuer: string): boolean {
  let url: URL;
  try {
    url = new URL(issuer);
  } catch {
    logger.error("OIDC provider disabled: AUTH_OIDC_ISSUER is not a valid URL", { issuer });
    return false;
  }

  if (url.protocol === "https:") return true;

  const isLoopback =
    url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (isLoopback) return true;

  logger.error("OIDC provider disabled: AUTH_OIDC_ISSUER must use https outside loopback", {
    issuer
  });
  return false;
}

/**
 * The provider appears on the sign-in page only when issuer, client id and
 * secret are all present — a half-configured provider would render a button
 * that can only ever fail.
 */
export function isOidcConfigured(): boolean {
  const issuer = env("AUTH_OIDC_ISSUER");
  if (!issuer || !env("AUTH_OIDC_ID") || !env("AUTH_OIDC_SECRET")) return false;
  return isUsableIssuer(issuer);
}

/** Button label on `/login`; the IdP's own name reads better than "SSO". */
export function oidcDisplayName(): string {
  return env("AUTH_OIDC_NAME") || DEFAULT_DISPLAY_NAME;
}

export function oidcProvider(): Provider {
  return {
    id: OIDC_PROVIDER_ID,
    name: oidcDisplayName(),
    type: "oidc",
    issuer: env("AUTH_OIDC_ISSUER"),
    clientId: env("AUTH_OIDC_ID"),
    clientSecret: env("AUTH_OIDC_SECRET"),
    // `openid` is mandatory; `email`/`profile` feed the allow-lists and the
    // username below. Group-based rules usually need an extra scope
    // (Keycloak: `groups`, Entra ID: `GroupMember.Read.All`) — hence the knob.
    authorization: { params: { scope: env("AUTH_OIDC_SCOPE") || DEFAULT_SCOPE } },
    // Auth.js defaults to PKCE + state for OIDC, but a few IdPs advertise no
    // PKCE support in discovery and would otherwise fall back silently.
    checks: ["pkce", "state"]
  };
}

/** Claims arrive as `unknown`; only the shapes we actually read are narrowed. */
function claim(profile: Record<string, unknown> | undefined, name: string): unknown {
  return profile?.[name];
}

function stringClaim(profile: Record<string, unknown> | undefined, name: string): string {
  const value = claim(profile, name);
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Group claims are not standardised: an array of names is the common case,
 * but a single string and space/comma-delimited strings all occur in the
 * wild, and some IdPs emit LDAP-style DNs (`/platform/admins`).
 */
function groupClaims(profile: Record<string, unknown> | undefined, name: string): string[] {
  const value = claim(profile, name);

  const raw = Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : typeof value === "string"
      ? value.split(/[,\s]+/)
      : [];

  return raw.map((entry) => entry.trim().toLowerCase()).filter(Boolean);
}

/**
 * An unverified address is a claim the user typed, not one the IdP stands
 * behind, so it may not be used to match an allow-listed address or domain.
 * A missing `email_verified` counts as unverified — that is the fail-closed
 * reading, and an IdP that omits it can still be matched on `sub` or groups.
 */
function verifiedEmail(profile: Record<string, unknown> | undefined): string {
  const email = stringClaim(profile, "email").toLowerCase();
  if (!email) return "";

  const verified = claim(profile, "email_verified");
  if (verified === true || verified === "true") return email;

  logger.warn("OIDC email ignored for authorization: email_verified is not true", { email });
  return "";
}

/**
 * The minimum an authorization decision needs, extracted from the ID token at
 * sign-in and carried in the session so the decision can be **re-made** on
 * later requests instead of being remembered as a yes.
 *
 * Only these three fields are kept. The rest of the profile is not the
 * portal's business, and the email is stored only when the IdP verified it —
 * so nothing that reaches `authorizeOidcIdentity()` later is weaker evidence
 * than what was checked at sign-in.
 */
export interface OidcIdentity {
  subject: string;
  /** Empty unless `email_verified` was true. */
  email: string;
  groups: string[];
}

/** Group lists can be long at some IdPs; the session cookie is not storage. */
const MAX_STORED_GROUPS = 32;
const MAX_GROUP_LENGTH = 96;

export function oidcIdentity(profile: Record<string, unknown> | undefined): OidcIdentity {
  return {
    subject: stringClaim(profile, "sub"),
    email: verifiedEmail(profile),
    groups: groupClaims(profile, env("AUTH_OIDC_GROUPS_CLAIM") || DEFAULT_GROUPS_CLAIM)
      .filter((group) => group.length <= MAX_GROUP_LENGTH)
      .slice(0, MAX_STORED_GROUPS)
  };
}

/**
 * Decides whether an authenticated OIDC user may use the portal.
 *
 * Any one rule matching is enough. With no rule configured nobody gets in:
 * an IdP that lets the whole internet register would otherwise hand the
 * portal to the whole internet.
 */
export function authorizeOidc(profile: Record<string, unknown> | undefined): boolean {
  return authorizeOidcIdentity(oidcIdentity(profile));
}

/**
 * The same rules, evaluated against a stored identity rather than a live
 * profile. Pure env comparison — no network — so it is cheap enough to run on
 * every request, which is what makes removing someone from an allow-list take
 * effect at their next request instead of whenever their session expires.
 */
export function authorizeOidcIdentity(identity: OidcIdentity): boolean {
  const { subject } = identity;
  if (!subject) {
    logger.warn("Portal access denied: OIDC identity carries no `sub` claim");
    return false;
  }

  const subjects = list("AUTH_ALLOWED_OIDC_SUBJECTS");
  const emails = list("AUTH_ALLOWED_OIDC_EMAILS");
  const domains = list("AUTH_ALLOWED_OIDC_DOMAINS").map((domain) => domain.replace(/^@/, ""));
  const groups = list("AUTH_ALLOWED_OIDC_GROUPS");

  if (!subjects.length && !emails.length && !domains.length && !groups.length) {
    logger.error(
      "Portal access denied: OIDC is configured but no AUTH_ALLOWED_OIDC_* rule is set, " +
        "so every account would otherwise be admitted"
    );
    return false;
  }

  if (subjects.includes(subject.toLowerCase())) return true;

  const email = identity.email;
  if (email) {
    if (emails.includes(email)) return true;

    const domain = email.slice(email.lastIndexOf("@") + 1);
    if (domain && domains.includes(domain)) return true;
  }

  if (groups.length && identity.groups.some((group) => groups.includes(group))) return true;

  logger.warn("Portal access denied: OIDC account matches no allow-list rule", {
    subject,
    email: email || "(none or unverified)"
  });
  return false;
}

/**
 * What the portal shows as the username. `preferred_username` is the usual
 * carrier, but it is optional in the spec — email, then the opaque `sub`,
 * keep the header from rendering blank.
 */
export function oidcUsername(profile: Record<string, unknown> | undefined): string {
  const claimName = env("AUTH_OIDC_USERNAME_CLAIM") || DEFAULT_USERNAME_CLAIM;

  return (
    stringClaim(profile, claimName) ||
    stringClaim(profile, "email") ||
    stringClaim(profile, "sub")
  );
}
