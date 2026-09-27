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

describe("clientAddress", () => {
  const headers = (entries: Record<string, string>) => new Headers(entries);

  it("prefers CF-Connecting-IP, which Cloudflare's edge overwrites", async () => {
    const { clientAddress } = await load();

    expect(
      clientAddress(
        headers({ "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "1.2.3.4, 10.42.0.9" })
      )
    ).toBe("cf:203.0.113.7");
    expect(clientAddress(headers({ "cf-connecting-ip": "2001:db8::1" }))).toBe("cf:2001:db8::1");
  });

  it("gives two tunnel clients separate keys even though XFF's last hop is shared", async () => {
    const { clientAddress } = await load();
    const tunnel = "10.42.0.9";

    const a = clientAddress(headers({ "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": tunnel }));
    const b = clientAddress(headers({ "cf-connecting-ip": "198.51.100.2", "x-forwarded-for": tunnel }));

    expect(a).not.toBe(b);
  });

  it("ignores a CF-Connecting-IP that is not an IP literal", async () => {
    const { clientAddress } = await load();

    expect(
      clientAddress(headers({ "cf-connecting-ip": "evil, 1.1.1.1", "x-forwarded-for": "10.0.0.1" }))
    ).toBe("10.0.0.1");
  });

  it("falls back to the last X-Forwarded-For entry, never a client-written earlier one", async () => {
    const { clientAddress } = await load();

    expect(clientAddress(headers({ "x-forwarded-for": "6.6.6.6, 10.0.0.1" }))).toBe("10.0.0.1");
    expect(clientAddress(headers({ "x-forwarded-for": " 10.0.0.1 , " }))).toBe("10.0.0.1");
  });

  it("shares one bucket when there is no header at all", async () => {
    const { clientAddress } = await load();

    expect(clientAddress(headers({}))).toBe("unknown");
  });
});
