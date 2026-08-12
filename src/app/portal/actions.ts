"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth, sessionKey, signOut } from "@/auth";
import { invalidatePortalSnapshot } from "@/features/services/server/snapshot";
import { rateLimit } from "@/lib/rate-limit";

/** Refresh is the one action that deliberately bypasses the snapshot cache. */
const REFRESH_LIMIT = 10;
const REFRESH_WINDOW_MS = 60_000;

/**
 * Re-runs discovery and the health probes by invalidating the portal's render.
 * A server action rather than a client fetch loop: the probing has to happen
 * in-cluster, and this keeps a single code path for it.
 *
 * The cached snapshot is dropped first, or the re-render would be served the
 * same numbers the user just asked to refresh. That bypass is exactly why this
 * needs its own limit: without one, holding the refresh button down is an
 * uncapped probe generator aimed at every service in the cluster. Over the
 * limit the action simply re-renders from cache — the page still updates, it
 * just does not re-probe.
 */
export async function refreshServices(): Promise<void> {
  const session = await auth();
  if (!session) redirect("/login?callbackUrl=/portal");

  const limited = rateLimit(
    `portal-refresh:${sessionKey(session)}`,
    REFRESH_LIMIT,
    REFRESH_WINDOW_MS
  );
  if (limited.ok) invalidatePortalSnapshot();

  revalidatePath("/portal");
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/" });
}
