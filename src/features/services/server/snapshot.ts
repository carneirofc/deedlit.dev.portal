import { discoverServices } from "@/features/services/server/discover";
import { checkServices } from "@/features/services/server/health";
import type {
  DiscoveryFailure,
  LocalServiceApp,
  ServiceHealthMap
} from "@/features/services/types";

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
 *
 * Coalescing means every reader waits on the same collection, so that
 * collection must end: it is raced against `COLLECT_DEADLINE_MS` and the
 * in-flight slot is cleared whatever the outcome. And a failed discovery is
 * never shown as "no services" — the last good snapshot is served, marked
 * `degraded`, so an outage looks like an outage.
 */

const TTL_MS = 15_000;

/** A failure is cached briefly, so a broken apiserver is not hammered. */
const FAILURE_TTL_MS = 5_000;

/**
 * Two sequential apiserver exchanges (the Ingress list, then the named-port
 * lookups in parallel) at `API_DEADLINE_MS` each, plus the 3s probes, with
 * margin.
 */
export const COLLECT_DEADLINE_MS = 16_000;

export interface PortalSnapshot {
  apps: LocalServiceApp[];
  health: ServiceHealthMap;
  /** When the underlying probes ran; surfaced so staleness is never hidden. */
  collectedAt: string;
  /** Set when a newer collection failed and this is the best there is. */
  degraded?: {
    reason: DiscoveryFailure;
    /** When discovery started failing (the first failure in the current run). */
    since: string;
    /** True when `apps`/`health` are a previous good snapshot; false when there is no data. */
    servingLastGood: boolean;
  };
}

let cached: { expiresAt: number; snapshot: PortalSnapshot } | null = null;
let inFlight: Promise<PortalSnapshot> | null = null;
let lastGood: PortalSnapshot | null = null;
let failingSince: string | null = null;

function degradedSnapshot(reason: DiscoveryFailure): PortalSnapshot {
  failingSince ??= new Date().toISOString();

  const base = lastGood ?? { apps: [], health: {}, collectedAt: failingSince };
  return {
    ...base,
    degraded: { reason, since: failingSince, servingLastGood: lastGood !== null }
  };
}

async function collect(): Promise<PortalSnapshot> {
  const discovery = await discoverServices();
  if (!discovery.ok) return degradedSnapshot(discovery.reason);

  const health = await checkServices(discovery.apps);
  const snapshot: PortalSnapshot = {
    apps: discovery.apps,
    health,
    collectedAt: new Date().toISOString()
  };

  lastGood = snapshot;
  failingSince = null;
  return snapshot;
}

function withDeadline(work: Promise<PortalSnapshot>): Promise<PortalSnapshot> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<PortalSnapshot>((resolve) => {
    timer = setTimeout(() => resolve(degradedSnapshot("unreachable")), COLLECT_DEADLINE_MS);
  });

  // A collection that throws is a failure like any other, not a 500.
  const settled = work.catch(() => degradedSnapshot("unreachable"));
  return Promise.race([settled, deadline]).finally(() => clearTimeout(timer));
}

export async function getPortalSnapshot(): Promise<PortalSnapshot> {
  if (cached && Date.now() < cached.expiresAt) return cached.snapshot;

  // Concurrent readers during a refresh wait on the same collection rather
  // than each starting their own.
  if (inFlight) return await inFlight;

  inFlight = withDeadline(collect())
    .then((snapshot) => {
      const ttl = snapshot.degraded ? FAILURE_TTL_MS : TTL_MS;
      cached = { expiresAt: Date.now() + ttl, snapshot };
      return snapshot;
    })
    .finally(() => {
      inFlight = null;
    });

  return await inFlight;
}

/**
 * Drops the cache so the next read re-probes. Used by the refresh action.
 * Deliberately leaves `inFlight` alone: a collection already running is the
 * fresh read being asked for, and restarting it would only double the fan-out.
 */
export function invalidatePortalSnapshot(): void {
  cached = null;
}
