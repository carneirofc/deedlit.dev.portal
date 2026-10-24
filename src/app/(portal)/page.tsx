import { Suspense } from "react";
import { refreshServices } from "@/app/actions";
import { PortalGuide } from "@/features/services/components/PortalGuide";
import { ServicesBoard } from "@/features/services/components/ServicesBoard";
import { ServiceSummary } from "@/features/services/components/ServiceSummary";
import { summarize } from "@/features/services/lib/summary";
import { getPortalSnapshot } from "@/features/services/server/snapshot";
import { requireSession } from "@/lib/auth/require-session";

// Discovery and health are live cluster state; caching the *render* would be a
// lie. The snapshot behind it has its own short TTL, which bounds how often a
// reload can make the portal probe every service — see `server/snapshot.ts`.
export const dynamic = "force-dynamic";

async function Services() {
  const { apps, health, collectedAt, degraded } = await getPortalSnapshot();

  return (
    <>
      <ServiceSummary summary={summarize(apps, health)} />
      <ServicesBoard
        apps={apps}
        health={health}
        collectedAt={collectedAt}
        degraded={degraded}
        refreshAction={refreshServices}
      />
    </>
  );
}

function ServicesSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {["services", "up", "down", "unknown", "latency"].map((key) => (
          <div key={key} className="h-[106px] animate-pulse rounded-xl border border-line/50 bg-surface/50" />
        ))}
      </div>
      <p className="text-sm text-muted">Discovering services and probing health…</p>
    </div>
  );
}

export default async function ServicesPage() {
  const session = await requireSession();
  const who = session.user?.username ? `@${session.user.username}` : session.user?.name;

  return (
    <main className="flex flex-col gap-6">
      <header>
        <p className="font-[var(--font-mono)] text-[11px] uppercase tracking-widest text-muted">
          deedlit.dev cluster{who ? ` · signed in as ${who}` : ""}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Services</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Everything the cluster publishes to this portal, with live in-cluster health. Click a card
          to open the service.
        </p>
      </header>

      {/* Streams the shell immediately; a slow probe delays only this part. */}
      <Suspense fallback={<ServicesSkeleton />}>
        <Services />
      </Suspense>

      <PortalGuide />
    </main>
  );
}
