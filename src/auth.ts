import NextAuth, { type Session } from "next-auth";
import type { JWT } from "next-auth/jwt";
import type { Provider } from "next-auth/providers";
import {
  authorizeGitHub,
  GITHUB_PROVIDER_ID,
  githubProvider,
  githubSubject,
  githubUsername,
  isGitHubConfigured,
  reauthorizeGitHub
} from "@/lib/auth/github";
import {
  authorizeOidc,
  authorizeOidcIdentity,
  isOidcConfigured,
  OIDC_PROVIDER_ID,
  oidcDisplayName,
  oidcIdentity,
  oidcProvider,
  oidcUsername
} from "@/lib/auth/oidc";
import { logger } from "@/lib/logger";

/**
 * Authentication for the private `/portal` area.
 *
 * Sessions are JWT-only: the portal stores nothing per user, so adding a
 * database adapter would buy nothing and cost a datastore. Authorization is
 * decided once, in `signIn` — the identity provider says *who* someone is,
 * the per-provider rules in `src/lib/auth/*` say whether they get in at all.
 *
 * Two providers are supported and either may be omitted: GitHub (org/team
 * membership) and a generic OIDC issuer (`src/lib/auth/oidc.ts`). A provider
 * that is not configured is simply not offered, and a request naming it is
 * refused — there is no implicit fallback between them.
 */

/** Eight hours: long enough to avoid re-auth during a session of work. */
const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

/**
 * The session cookie is a JWE signed and encrypted with `AUTH_SECRET`, so
 * forging one means brute-forcing that value. Auth.js only checks that the
 * secret exists; a deployment that set it to `changeme` would authenticate
 * fine and be trivially forgeable. 32 characters is the length `openssl rand
 * -base64 32` produces and the floor Auth.js documents.
 */
const MIN_SECRET_LENGTH = 32;

/**
 * Checked per sign-in rather than at module load: this module is imported
 * during `next build`, where no secret exists and a throw would break CI.
 */
export function hasUsableSecret(): boolean {
  const secret = process.env.AUTH_SECRET ?? "";
  if (secret.length >= MIN_SECRET_LENGTH) return true;

  logger.error(
    "Portal sign-in denied: AUTH_SECRET is missing or shorter than " +
      `${MIN_SECRET_LENGTH} characters, which would leave session tokens forgeable`
  );
  return false;
}

/**
 * `AUTH_URL` is what stops `trustHost` from being a liability.
 *
 * `trustHost: true` is mandatory behind Traefik, but it means Auth.js derives
 * its own origin from the request's `Host`/`X-Forwarded-Host` header — which a
 * client sets. Pinning `AUTH_URL` makes the origin configuration rather than
 * input, so sign-in links, cookie scope and the OAuth `redirect_uri` cannot be
 * steered by a forged header. It also decides `useSecureCookies` below.
 */
const configuredAuthUrl = process.env.AUTH_URL?.trim();

export interface SignInProvider {
  id: string;
  /** Button label on `/login`. */
  label: string;
}

/**
 * The providers this deployment can actually complete a sign-in with. The
 * login page renders exactly these, so a missing client secret shows up as an
 * absent button rather than a redirect into an error page.
 *
 * Read per call, not cached: `next build` imports this module with no env at
 * all, and caching there would freeze an empty list into the build.
 */
export function signInProviders(): SignInProvider[] {
  const providers: SignInProvider[] = [];

  if (isGitHubConfigured()) {
    providers.push({ id: GITHUB_PROVIDER_ID, label: "Continue with GitHub" });
  }
  if (isOidcConfigured()) {
    providers.push({ id: OIDC_PROVIDER_ID, label: `Continue with ${oidcDisplayName()}` });
  }

  return providers;
}

/**
 * Whether the session in hand still passes today's rules.
 *
 * The session cookie is an encrypted, signed JWE: its contents cannot be
 * edited or forged without `AUTH_SECRET`, so "the user tampered with a claim"
 * is not the threat this guards against — that one is closed by cryptography
 * and by the minimum-length check above. The threat it *does* guard against is
 * subtler and far more likely: a token that was legitimately issued and has
 * since stopped deserving access, because the account was removed from an
 * allow-list, dropped out of a group, or the provider was switched off.
 *
 * So authorization is never stored as a yes and trusted later. Only the raw
 * identity is carried, and the decision is recomputed from it on every request
 * — `jwt` runs on every `auth()` call, and returning `null` there ends the
 * session immediately. It is a local comparison against environment
 * configuration, so this costs no network round-trip.
 */
export function stillAuthorized(token: JWT): boolean {
  switch (token.provider) {
    case GITHUB_PROVIDER_ID:
      return isGitHubConfigured() && reauthorizeGitHub(token.username ?? "");

    case OIDC_PROVIDER_ID:
      return (
        isOidcConfigured() &&
        authorizeOidcIdentity({
          subject: token.subject ?? "",
          email: token.verifiedEmail ?? "",
          groups: token.groups ?? []
        })
      );

    default:
      // No provider stamp at all: either a token from before this field
      // existed, or one issued by a provider that has since been removed.
      logger.warn("Portal session rejected: unknown or missing provider", {
        provider: token.provider ?? "(none)"
      });
      return false;
  }
}

/**
 * A stable per-account key for rate limiting. Derived from the session, whose
 * contents the client cannot rewrite, so a caller cannot escape their bucket
 * by changing anything they control. The subject is the provider's immutable
 * account id, so it survives a username change.
 */
export function sessionKey(session: Session): string {
  const provider = session.user?.provider ?? "unknown";
  const subject = session.user?.subject ?? session.user?.username ?? "unknown";

  return `${provider}:${subject}`;
}

function configuredProviders(): Provider[] {
  const providers: Provider[] = [];

  if (isGitHubConfigured()) providers.push(githubProvider());
  if (isOidcConfigured()) providers.push(oidcProvider());

  if (!providers.length) {
    logger.warn(
      "No authentication provider is configured — set AUTH_GITHUB_ID/SECRET or " +
        "AUTH_OIDC_ISSUER/ID/SECRET, or nobody can sign in to the portal"
    );
  }

  return providers;
}

export const { auth, handlers, signIn, signOut } = NextAuth({
  providers: configuredProviders(),
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS },
  // The cookie must expire with the session it carries, or a stale token stays
  // presentable after the session it represents is over.
  jwt: { maxAge: SESSION_MAX_AGE_SECONDS },
  // Auth.js cannot infer its own origin from behind Traefik without this.
  // Safe only in combination with AUTH_URL — see above.
  trustHost: true,
  // Forces the `__Secure-` cookie prefix and the Secure attribute, so the
  // session cookie is never emitted over plaintext where a network attacker
  // could strip TLS and capture it. Derived from AUTH_URL when set so that
  // running the production build against http://127.0.0.1 still works.
  useSecureCookies: configuredAuthUrl
    ? configuredAuthUrl.startsWith("https://")
    : process.env.NODE_ENV === "production",
  pages: {
    signIn: "/login",
    error: "/login"
  },
  callbacks: {
    async signIn({ account, profile }) {
      if (!hasUsableSecret()) return false;

      // `profile` is typed loosely per provider; both authorizers read named
      // claims defensively, so a bare record is the honest shape.
      const claims = profile as Record<string, unknown> | undefined;

      switch (account?.provider) {
        case GITHUB_PROVIDER_ID:
          return await authorizeGitHub(claims, account.access_token);
        case OIDC_PROVIDER_ID:
          return authorizeOidc(claims);
        default:
          // Includes the case where the provider was removed from the config
          // between issuing an authorization request and its callback.
          logger.warn("Portal sign-in denied: unknown provider", {
            provider: account?.provider ?? "(none)"
          });
          return false;
      }
    },

    async jwt({ token, account, profile }) {
      // Runs on every request that reads the session, not only at sign-in.
      // A secret too weak to make the cookie unforgeable invalidates every
      // session rather than quietly continuing to honour them.
      if (!hasUsableSecret()) return null;

      // Only on initial sign-in do `account` and `profile` exist. No provider
      // access token is persisted here — each has done its job in `signIn`,
      // and keeping one would park a live credential in the session cookie.
      // What is persisted is the identity the rules are evaluated against, so
      // that `stillAuthorized()` can re-derive the decision rather than
      // inherit it.
      const claims = profile as Record<string, unknown> | undefined;

      if (account?.provider === GITHUB_PROVIDER_ID) {
        token.provider = GITHUB_PROVIDER_ID;
        token.username = githubUsername(claims) || token.username;
        token.subject = githubSubject(claims) || token.subject;
      } else if (account?.provider === OIDC_PROVIDER_ID) {
        const identity = oidcIdentity(claims);

        token.provider = OIDC_PROVIDER_ID;
        token.username = oidcUsername(claims) || token.username;
        token.subject = identity.subject || token.subject;
        // Named apart from the standard `email` claim on purpose: that one is
        // whatever the IdP sent, verified or not, and must never be what an
        // allow-list matches on.
        token.verifiedEmail = identity.email;
        token.groups = identity.groups;
      }

      // Returning null here ends the session — the cookie stops being honoured
      // on the very next request.
      return stillAuthorized(token) ? token : null;
    },

    async session({ session, token }) {
      if (session.user && typeof token.username === "string") {
        session.user.username = token.username;
      }
      if (session.user && typeof token.provider === "string") {
        session.user.provider = token.provider;
      }
      if (session.user && typeof token.subject === "string") {
        session.user.subject = token.subject;
      }
      return session;
    }
  }
});
