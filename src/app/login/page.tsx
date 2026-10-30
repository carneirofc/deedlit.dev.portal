import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FiGithub, FiLock, FiShield } from "react-icons/fi";
import { StatusBanner } from "@carneirofc/ui";
import { auth, signIn, signInProviders } from "@/auth";
import { clientKey, rateLimit, SIGN_IN_LIMIT, SIGN_IN_WINDOW_MS } from "@/lib/rate-limit";
import { safeCallbackUrl } from "@/lib/safe-redirect";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false }
};

/**
 * Auth.js sends every failure back here via `pages.error`. `AccessDenied` is
 * the one worth spelling out: it means the provider authenticated the user
 * fine and the allow-list then turned them away — without a distinct message
 * that looks like a broken login rather than a deliberate refusal.
 */
function errorMessage(code: string | undefined): string | null {
  if (!code) return null;

  switch (code) {
    case "AccessDenied":
      return "You signed in, but that account is not on this portal's allow-list. Ask the administrator to add it.";
    case "RateLimited":
      return "Too many sign-in attempts. Wait a minute and try again.";
    case "Verification":
      return "The sign-in link has expired. Try again.";
    case "Configuration":
      return "That sign-in method is not available on this deployment.";
    default:
      return "Sign-in failed. Try again, or check the server logs if it keeps happening.";
  }
}

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string; signedOut?: string }>;
}) {
  const { callbackUrl, error, signedOut } = await searchParams;
  // Attacker-controlled; never pass the raw value on — see `safe-redirect.ts`.
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

    // The Auth.js route handler enforces the same bucket; checking here as well
    // turns a refusal into a friendly error page instead of a bare 429.
    const limited = rateLimit(await clientKey("sign-in"), SIGN_IN_LIMIT, SIGN_IN_WINDOW_MS);
    if (!limited.ok) redirect("/login?error=RateLimited");

    // Goes through the Auth.js handler, which owns the CSRF token — never
    // hand-roll this POST.
    await signIn(provider.id, { redirectTo: destination });
  }

  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl border border-accent/40 bg-accent/10 text-sm font-semibold tracking-wider text-accent">
            DL
          </span>
          <div className="leading-tight">
            <p className="text-[1rem] font-semibold tracking-tight text-text">deedlit.dev</p>
            <p className="font-[var(--font-mono)] text-[10px] uppercase tracking-widest text-muted">
              service portal
            </p>
          </div>
        </div>

        <section className="rounded-2xl border border-line/70 bg-surface/80 p-6 shadow-soft">
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <FiLock className="h-4 w-4 text-accent" aria-hidden />
            Sign in
          </h1>
          <p className="mt-2 text-sm text-muted">
            The portal lists the cluster&apos;s services and their health. It is private: only
            allow-listed accounts get in.
          </p>

          {signedOut && !message && (
            <p className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600 dark:text-emerald-400">
              You have been signed out.
            </p>
          )}

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
                  <button
                    type="submit"
                    className="focus-ring flex w-full items-center justify-center gap-2 rounded-lg border border-line/80 bg-base/60 px-4 py-2.5 text-sm! font-medium transition hover:border-accent/60 hover:bg-accent/10 hover:text-accent motion-safe:active:scale-[0.98]"
                  >
                    {provider.id === "github" ? (
                      <FiGithub className="h-4 w-4" aria-hidden />
                    ) : (
                      <FiShield className="h-4 w-4" aria-hidden />
                    )}
                    {provider.label}
                  </button>
                </form>
              ))}
            </div>
          )}
        </section>

        <p className="mt-4 text-center text-xs text-muted">
          Reachable over the WireGuard tunnel only. Sessions end after 8 hours idle.
        </p>
      </div>
    </main>
  );
}
