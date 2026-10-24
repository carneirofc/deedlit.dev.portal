import type { DefaultSession } from "next-auth";
import type { GitHubGrant } from "@/lib/auth/github";

declare module "next-auth" {
  interface Session {
    user: {
      /**
       * GitHub login (e.g. "carneirofc"), or the OIDC username claim —
       * `preferred_username`, falling back to email then `sub`. Display only:
       * a login can be renamed and re-registered, so it never identifies a
       * session.
       */
      username?: string;
      /** Which provider issued this session: "github" or "oidc". */
      provider?: string;
      /**
       * The provider's immutable account id — GitHub's numeric id or the OIDC
       * `sub`. This is the identity: stable across renames, and the key rate
       * limits are counted against.
       */
      subject?: string;
      /**
       * Which rule admitted the session, e.g. "GitHub user allow-list".
       * Display only — authorization is re-derived from the token on every
       * request and never read back from this.
       */
      access?: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    username?: string;
    provider?: string;
    subject?: string;
    /**
     * The email **only if** the IdP set `email_verified`. Kept separate from
     * the standard `email` claim, which carries whatever was sent and must
     * never be what an allow-list matches on.
     */
    verifiedEmail?: string;
    /** Normalised group claims, retained so access can be re-decided later. */
    groups?: string[];
    /**
     * Which GitHub rule admitted this session (user allow-list, or org/team).
     * Evidence re-checked against the current config on every request — never
     * a cached "authorized" flag.
     */
    githubGrant?: GitHubGrant;
  }
}
