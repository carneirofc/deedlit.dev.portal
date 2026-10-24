import { AppShell } from "@/components/layout/AppShell";
import { requireSession } from "@/lib/auth/require-session";

/**
 * The server-side security boundary for every signed-in page.
 *
 * `src/proxy.ts` turns anonymous requests away first, but it is a path
 * matcher; this check runs inside the render on every request, however it
 * arrived. Each page under this group still calls `requireSession()` itself
 * where it reads the session — layouts do not re-render on client navigation,
 * so a page must never rely on its layout having run.
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();

  return <AppShell user={session.user}>{children}</AppShell>;
}
