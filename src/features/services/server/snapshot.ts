import { discoverServices } from "@/features/services/server/discover";
import { checkServices } from "@/features/services/server/health";
import type { LocalServiceApp, ServiceHealthMap } from "@/features/services/types";

/**
 * One shared, short-lived view of the cluster for every portal reader.
 *
 * Rendering `/portal` or calling `/api/portal/services` costs an apiserver
 * list plus one HTTP probe per service. Without a bound, a signed-in user
 * holding F5 — or a stuck browser tab — turns a single session into a steady
 * fan-out against every service in the cluster, and the portal becomes the
 * loudest client of the things it is supposed to be watching. Authentication
 * does not fix that: the portal's whole audience is authenticated.
 *
 * A per-process TTL plus in-flight coalescing keeps the cost flat at roughly
 * one refresh per `TTL_MS` no matter how many readers or requests there are.
 * The data is a liveness snapshot, so a few seconds of staleness is not a
 * meaningful loss of truth — and the refresh button clears it outright.
 */

const TTL_MS = 15_000;

export interface PortalSnapshot {
  apps: LocalServiceApp[];
  health: ServiceHealthMap;
  /** When the underlying probes ran; surfaced so staleness is never hidden. */
  collectedAt: string;
}

let cached: { at: number; snapshot: PortalSnapshot } | null = null;
let inFlight: Promise<PortalSnapshot> | null = null;

async function collect(): Promise<PortalSnapshot> {
  const apps = await discoverServices();
  const health = await checkServices(apps);

  return { apps, health, collectedAt: new Date().toISOString() };
}

export async function getPortalSnapshot(): Promise<PortalSnapshot> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.snapshot;

  // Concurrent readers during a refresh wait on the same collection rather
  // than each starting their own.
  if (inFlight) return await inFlight;

  inFlight = collect()
    .then((snapshot) => {
      cached = { at: Date.now(), snapshot };
      return snapshot;
    })
    .finally(() => {
      inFlight = null;
    });

  return await inFlight;
}

/** Drops the cache so the next read re-probes. Used by the refresh action. */
export function invalidatePortalSnapshot(): void {
  cached = null;
}
