import type { Metadata } from "next";
import { FiGithub, FiLogOut, FiShield } from "react-icons/fi";
import { KeyValueField } from "@carneirofc/ui";
import { signOutAction } from "@/app/actions";
import { initials } from "@/components/layout/AppShell";
import { requireSession } from "@/lib/auth/require-session";

export const metadata: Metadata = { title: "Account" };

export const dynamic = "force-dynamic";

const PROVIDER_LABEL: Record<string, string> = {
  github: "GitHub",
  oidc: "Single sign-on (OIDC)"
};

export default async function AccountPage() {
  const session = await requireSession("/account");
  const user = session.user;
  const provider = user?.provider ?? "unknown";
  const ProviderIcon = provider === "github" ? FiGithub : FiShield;

  return (
    <main className="flex flex-col gap-6">
      <header>
        <p className="font-[var(--font-mono)] text-[11px] uppercase tracking-widest text-muted">
          signed in
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Account</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Who this portal thinks you are, and why it lets you in.
        </p>
      </header>

      <section className="rounded-xl border border-line/70 bg-surface/70 p-5 shadow-soft">
        <div className="flex flex-wrap items-center gap-4">
          <span className="grid h-14 w-14 place-items-center rounded-xl border border-accent/40 bg-accent/10 text-lg font-semibold text-accent">
            {initials(user)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold">{user?.name || user?.username || "—"}</p>
            <p className="flex items-center gap-1.5 truncate text-sm text-muted">
              <ProviderIcon className="h-3.5 w-3.5" aria-hidden />
              {user?.username ? `@${user.username}` : "no username claim"}
              {user?.email && <span className="text-muted/70">· {user.email}</span>}
            </p>
          </div>
          <form action={signOutAction} className="ml-auto">
            <button
              type="submit"
              className="focus-ring flex items-center gap-2 rounded-lg border border-line/70 px-3 py-1.5 text-sm! text-muted transition hover:border-rose-400/60 hover:bg-rose-500/10 hover:text-rose-400 motion-safe:active:scale-[0.97]"
            >
              <FiLogOut className="h-4 w-4" aria-hidden />
              Sign out
            </button>
          </form>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KeyValueField label="Signed in with" value={PROVIDER_LABEL[provider] ?? provider} />
          <KeyValueField label="Access granted by" value={user?.access ?? "—"} />
          <KeyValueField
            label="Account id"
            value={<span className="font-[var(--font-mono)] text-xs">{user?.subject ?? "—"}</span>}
          />
          <KeyValueField label="Idle timeout" value="8 hours" />
        </div>
      </section>

      <section className="rounded-xl border border-line/70 bg-surface/60 p-5">
        <h2 className="text-sm font-semibold">How your session is handled</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted">
          <li>
            The session lives in an encrypted cookie only; the portal keeps no database of users
            and never stores your {provider === "github" ? "GitHub" : "identity provider"} access
            token.
          </li>
          <li>
            Access is re-checked against the current allow-lists on every request. If you are
            removed from them, this session stops working on the next click, not at expiry.
          </li>
          <li>
            Membership held at the provider —{" "}
            {provider === "github" ? "GitHub organization or team membership" : "your groups at the identity provider"}{" "}
            — is read at sign-in. A change there applies the next time you sign in.
          </li>
          <li>
            After 8 hours without activity the session expires and you are sent back to the sign-in
            page.
          </li>
        </ul>
      </section>
    </main>
  );
}
