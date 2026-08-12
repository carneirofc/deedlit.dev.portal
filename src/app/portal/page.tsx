import { Suspense } from "react";
import { FiLogOut } from "react-icons/fi";
import {
  CyberPanel,
  InfoChip,
  OutlineButton,
  PageHeader,
  SurfacePanel
} from "@carneirofc/ui";
import { auth } from "@/auth";
import { refreshServices, signOutAction } from "@/app/portal/actions";
import { ServicesSection } from "@/features/services/components/ServicesSection";
import { getPortalSnapshot } from "@/features/services/server/snapshot";

// Discovery and health are live cluster state; caching the *render* would be a
// lie. The snapshot behind it has its own short TTL, which bounds how often a
// reload can make the portal probe every service — see `server/snapshot.ts`.
export const dynamic = "force-dynamic";

async function ServicesPanel() {
  const { apps, health } = await getPortalSnapshot();

  return (
    <SurfacePanel tone="soft" padding="none" className="scroll-mt-20 overflow-hidden">
      <ServicesSection apps={apps} health={health} refreshAction={refreshServices} />
    </SurfacePanel>
  );
}

function ServicesSkeleton() {
  return (
    <SurfacePanel tone="soft" padding="lg">
      <p className="text-sm text-muted">Discovering services and probing health…</p>
    </SurfacePanel>
  );
}

export default async function PortalPage() {
  // The layout has already rejected anonymous requests; this read is for the
  // greeting only.
  const session = await auth();

  return (
    <main className="flex w-full flex-col gap-6">
      <CyberPanel id="top" className="scroll-mt-20">
        <PageHeader
          subtitle="deedlit.dev // private"
          title="Service Portal"
          description="Cluster services, their addresses, and live health."
          pills={
            <div className="flex flex-wrap items-center gap-2">
              {session?.user?.username && <InfoChip>@{session.user.username}</InfoChip>}
              <form action={signOutAction}>
                <OutlineButton type="submit" controlSize="xs">
                  <FiLogOut className="h-3.5 w-3.5" />
                  Sign out
                </OutlineButton>
              </form>
            </div>
          }
        />
      </CyberPanel>

      {/* Streams the shell immediately; a slow probe delays only the grid. */}
      <Suspense fallback={<ServicesSkeleton />}>
        <ServicesPanel />
      </Suspense>
    </main>
  );
}
