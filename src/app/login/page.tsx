import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FiGithub, FiShield } from "react-icons/fi";
import { OutlineButton, PageHeader, StatusBanner, SurfacePanel } from "@carneirofc/ui";
import { auth, signIn, signInProviders } from "@/auth";
import { clientKey, rateLimit } from "@/lib/rate-limit";

/**
 * Sign-in is unauthenticated, so it is keyed on the client address rather than
 * a session. Each attempt costs an outbound round-trip to GitHub or the IdP;
 * ten a minute is generous for a human and unhelpful as an amplifier.
 */
const SIGN_IN_LIMIT = 10;
const SIGN_IN_WINDOW_MS = 60_000;

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false }
};

/**
 * Auth.js sends every failure back here via `pages.error`. `AccessDenied` is
 * the one worth spelling out: it means GitHub authenticated the user fine and
 * the org/team check then turned them away — without a distinct message that
 * looks like a broken login rather than a deliberate refusal.
 */
/**
 * `callbackUrl` arrives in the query string, so it is attacker-controlled: a
 * link to `/login?callbackUrl=https://evil.example` would otherwise bounce an
 * already-signed-in user straight off the origin, with the portal's own
 * hostname lending the hop credibility.
 *
 * Only a site-relative path is ever honoured. `//evil.example` and
 * `/\evil.example` are rejected too — browsers read both as protocol-relative
 * URLs, so a leading-slash test alone is not enough.
 */
function safeCallbackUrl(raw: string | undefined): string {
  if (!raw) return "/portal";
  if (!raw.startsWith("/")) return "/portal";
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/portal";
  return raw;
}

function errorMessage(code: string | undefined): string | null {
  if (!code) return null;

  switch (code) {
    case "AccessDenied":
      return "That account is not on the allow-list this portal is restricted to.";
    case "RateLimited":
      return "Too many sign-in attempts. Wait a minute and try again.";
    case "Verification":
      return "The sign-in link has expired. Try again.";
    default:
      return "Sign-in failed. Try again, or check the server logs if it keeps happening.";
  }
}

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const { callbackUrl, error } = await searchParams;
  const destination = safeCallbackUrl(callbackUrl);

  const session = await auth();
  if (session) redirect(destination);

  const message = errorMessage(error);
  const providers = signInProviders();

  /**
   * The provider id arrives from the form, so it is re-checked against the
   * configured list before reaching `signIn()` — a hand-crafted POST must not
   * be able to name a provider this deployment does not offer.
   */
  async function startSignIn(formData: FormData) {
    "use server";
    const requested = formData.get("provider");
    const provider = signInProviders().find((entry) => entry.id === requested);
    if (!provider) redirect("/login?error=Configuration");

    const limited = rateLimit(await clientKey("sign-in"), SIGN_IN_LIMIT, SIGN_IN_WINDOW_MS);
    if (!limited.ok) redirect("/login?error=RateLimited");

    // Goes through the Auth.js handler, which owns the CSRF token — never
    // hand-roll this POST.
    await signIn(provider.id, { redirectTo: destination });
  }

  return (
    <main className="flex w-full flex-col gap-6">
      <SurfacePanel tone="soft" padding="lg" className="mx-auto mt-16 w-full max-w-md">
        <PageHeader
          subtitle="deedlit.dev // private"
          title="Sign in"
          description="The service portal is restricted to authorized accounts."
        />

        {message && (
          <div className="mt-4">
            <StatusBanner tone="error">{message}</StatusBanner>
          </div>
        )}

        {providers.length === 0 ? (
          <div className="mt-6">
            <StatusBanner tone="error">
              No sign-in provider is configured on this deployment.
            </StatusBanner>
          </div>
        ) : (
          <div className="mt-6 flex flex-col gap-3">
            {providers.map((provider) => (
              <form action={startSignIn} key={provider.id}>
                <input type="hidden" name="provider" value={provider.id} />
                <OutlineButton type="submit" className="w-full justify-center">
                  {provider.id === "github" ? (
                    <FiGithub className="h-4 w-4" aria-hidden />
                  ) : (
                    <FiShield className="h-4 w-4" aria-hidden />
                  )}
                  {provider.label}
                </OutlineButton>
              </form>
            ))}
          </div>
        )}
      </SurfacePanel>
    </main>
  );
}
