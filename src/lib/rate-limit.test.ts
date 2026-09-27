import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `rateLimit` keeps its windows in module state; a fresh module per test keeps
// the cases independent.
async function load() {
  vi.resetModules();
  return await import("./rate-limit");
}

describe("rateLimit", () => {
  beforeEach(() => vi.useFakeTimers({ now: 0 }));
  afterEach(() => vi.useRealTimers());

  it("denies the call after the limit with the time left in the window", async () => {
    const { rateLimit } = await load();

    for (let i = 0; i < 10; i++) expect(rateLimit("k", 10, 60_000).ok).toBe(true);

    vi.advanceTimersByTime(15_000);
    expect(rateLimit("k", 10, 60_000)).toEqual({ ok: false, retryAfter: 45 });
  });

  it("starts a fresh window once the old one expires", async () => {
    const { rateLimit } = await load();

    for (let i = 0; i < 11; i++) rateLimit("k", 10, 60_000);
    vi.advanceTimersByTime(60_000);

    expect(rateLimit("k", 10, 60_000).ok).toBe(true);
  });

  it("keeps separate budgets per key", async () => {
    const { rateLimit } = await load();

    for (let i = 0; i < 11; i++) rateLimit("a", 10, 60_000);
    expect(rateLimit("b", 10, 60_000).ok).toBe(true);
  });

  it("refuses new keys when the map is full of live windows, and sweeps expired ones", async () => {
    const { rateLimit } = await load();

    for (let i = 0; i < 5_000; i++) rateLimit(`key-${i}`, 10, 60_000);
    expect(rateLimit("one-too-many", 10, 60_000).ok).toBe(false);

    vi.advanceTimersByTime(60_000);
    expect(rateLimit("after-expiry", 10, 60_000).ok).toBe(true);
  });
});
