import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalServiceApp } from "@/features/services/types";

const discoverServices = vi.fn();
const checkServices = vi.fn();

vi.mock("@/features/services/server/discover", () => ({ discoverServices }));
vi.mock("@/features/services/server/health", () => ({ checkServices }));

const app: LocalServiceApp = {
  id: "a",
  name: "A",
  host: "a.deedlit.dev",
  url: "https://a.deedlit.dev",
  description: "",
  category: "other",
  icon: "generic",
  order: 0
};

// The snapshot keeps its cache in module state; each test gets a fresh one.
async function load() {
  vi.resetModules();
  return await import("./snapshot");
}

beforeEach(() => {
  vi.useFakeTimers({ now: 0 });
  discoverServices.mockReset();
  checkServices.mockReset();
  checkServices.mockResolvedValue({ a: { state: "up", checkedAt: "t" } });
});
afterEach(() => vi.useRealTimers());

describe("getPortalSnapshot", () => {
  it("coalesces concurrent readers and caches a good snapshot", async () => {
    const { getPortalSnapshot } = await load();
    discoverServices.mockResolvedValue({ ok: true, apps: [app], source: "cluster" });

    const [first, second] = await Promise.all([getPortalSnapshot(), getPortalSnapshot()]);
    await getPortalSnapshot();

    expect(first).toBe(second);
    expect(first.degraded).toBeUndefined();
    expect(discoverServices).toHaveBeenCalledTimes(1);
  });

  it("does not wedge when discovery never settles, and starts afresh next time", async () => {
    const { COLLECT_DEADLINE_MS, getPortalSnapshot } = await load();
    discoverServices.mockReturnValueOnce(new Promise(() => {}));

    const pending = getPortalSnapshot();
    await vi.advanceTimersByTimeAsync(COLLECT_DEADLINE_MS);
    const snapshot = await pending;

    expect(snapshot.degraded).toMatchObject({ reason: "unreachable", servingLastGood: false });
    expect(snapshot.apps).toEqual([]);

    // Past the failure TTL, a new reader triggers a new collection.
    discoverServices.mockResolvedValue({ ok: true, apps: [app], source: "cluster" });
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await getPortalSnapshot()).apps).toEqual([app]);
  });

  it("serves the last good snapshot, marked degraded, when discovery fails", async () => {
    const { getPortalSnapshot, invalidatePortalSnapshot } = await load();
    discoverServices.mockResolvedValueOnce({ ok: true, apps: [app], source: "cluster" });
    const good = await getPortalSnapshot();

    discoverServices.mockResolvedValue({ ok: false, reason: "rbac" });
    invalidatePortalSnapshot();
    const degraded = await getPortalSnapshot();

    expect(degraded.apps).toEqual([app]);
    expect(degraded.collectedAt).toBe(good.collectedAt);
    expect(degraded.degraded).toMatchObject({ reason: "rbac", servingLastGood: true });
  });

  it("treats a thrown collection as a failure, not an error page", async () => {
    const { getPortalSnapshot } = await load();
    discoverServices.mockRejectedValue(new Error("boom"));

    expect((await getPortalSnapshot()).degraded?.reason).toBe("unreachable");
  });

  it("caches a failure only briefly", async () => {
    const { getPortalSnapshot } = await load();
    discoverServices.mockResolvedValue({ ok: false, reason: "unauthenticated" });

    await getPortalSnapshot();
    await getPortalSnapshot();
    expect(discoverServices).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    await getPortalSnapshot();
    expect(discoverServices).toHaveBeenCalledTimes(2);
  });
});
