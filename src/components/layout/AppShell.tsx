import type { Session } from "next-auth";
import Link from "next/link";
import { FiGithub, FiLogOut, FiShield } from "react-icons/fi";
import { signOutAction } from "@/app/actions";
import { NavLinks } from "@/components/layout/NavLinks";
import { ThemeToggle } from "@/components/layout/ThemeToggle";

export function initials(user: Session["user"]): string {
  const source = user?.name || user?.username || user?.email || "?";
  const parts = source.replace(/@.*$/, "").split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : source.slice(0, 2);
  return letters.toUpperCase();
}

/**
 * The frame around every signed-in page. Rendered only from the `(portal)`
 * layout, after its session check, so it can assume a user.
 */
export function AppShell({ user, children }: { user: Session["user"]; children: React.ReactNode }) {
  const ProviderIcon = user?.provider === "github" ? FiGithub : FiShield;
  const handle = user?.username ? `@${user.username}` : (user?.name ?? "signed in");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-line/60 bg-base/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6 lg:px-8">
          <Link href="/" className="focus-ring flex items-center gap-2 rounded-md">
            <span className="grid h-8 w-8 place-items-center rounded-lg border border-accent/40 bg-accent/10 text-xs font-semibold tracking-wider text-accent">
              DL
            </span>
            <span className="leading-tight">
              <span className="block text-sm font-semibold tracking-tight">deedlit.dev</span>
              <span className="block font-[var(--font-mono)] text-[10px] uppercase tracking-widest text-muted">
                service portal
              </span>
            </span>
          </Link>

          <NavLinks />

          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/account"
              className="focus-ring hidden items-center gap-2 rounded-lg border border-line/70 px-2 py-1 text-xs text-muted transition hover:border-accent/50 hover:text-text sm:flex"
              title="Account details"
            >
              <span className="grid h-6 w-6 place-items-center rounded-md bg-accent/15 text-[10px] font-semibold text-accent">
                {initials(user)}
              </span>
              <ProviderIcon className="h-3.5 w-3.5" aria-hidden />
              <span className="max-w-[12rem] truncate">{handle}</span>
            </Link>
            <ThemeToggle />
            <form action={signOutAction}>
              <button
                type="submit"
                title="Sign out"
                aria-label="Sign out"
                className="focus-ring grid h-9 w-9 place-items-center rounded-lg border border-line/70 text-muted transition hover:border-rose-400/60 hover:text-rose-400"
              >
                <FiLogOut className="h-4 w-4" aria-hidden />
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</div>

      <footer className="border-t border-line/50">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-4 text-xs text-muted sm:px-6 lg:px-8">
          <span>deedlit.dev service portal</span>
          <span aria-hidden>·</span>
          <span>WireGuard-only</span>
          <span aria-hidden>·</span>
          <a
            href="https://github.com/carneirofc/deedlit.dev.portal"
            target="_blank"
            rel="noreferrer"
            className="focus-ring rounded hover:text-text"
          >
            source
          </a>
        </div>
      </footer>
    </div>
  );
}
