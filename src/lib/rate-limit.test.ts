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

  it("evicts the oldest window at the cap instead of refusing everyone new", async () => {
    const { rateLimit } = await load();

    // A flood of junk keys must not lock a newcomer out.
    for (let i = 0; i < 5_000; i++) rateLimit(`junk-${i}`, 10, 60_000);
    expect(rateLimit("newcomer", 10, 60_000).ok).toBe(true);

    // The oldest junk window was the one dropped: it starts over at 1.
    for (let i = 0; i < 10; i++) rateLimit("newcomer", 10, 60_000);
    expect(rateLimit("newcomer", 10, 60_000).ok).toBe(false);
  });

  it("still sweeps expired windows before evicting a live one", async () => {
    const { rateLimit } = await load();

    for (let i = 0; i < 11; i++) rateLimit("victim", 10, 60_000);
    vi.advanceTimersByTime(30_000);
    for (let i = 0; i < 4_999; i++) rateLimit(`k-${i}`, 10, 10_000);
    vi.advanceTimersByTime(10_000);

    expect(rateLimit("after-expiry", 10, 60_000).ok).toBe(true);
    // The victim's live window survived the sweep: still over its limit.
    expect(rateLimit("victim", 10, 60_000).ok).toBe(false);
  });
});

describe("clientAddress", () => {
  const headers = (entries: Record<string, string>) => new Headers(entries);

  afterEach(() => vi.unstubAllEnvs());

  describe("on a deployment that is public on purpose", () => {
    beforeEach(() => vi.stubEnv("PORTAL_ALLOW_PUBLIC_EDGE", "true"));

    it("prefers CF-Connecting-IP, which Cloudflare's edge overwrites", async () => {
      const { clientAddress } = await load();

      expect(
        clientAddress(
          headers({ "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "1.2.3.4, 10.42.0.9" })
        )
      ).toBe("cf:203.0.113.7");
      expect(clientAddress(headers({ "cf-connecting-ip": "2001:db8::1" }))).toBe("cf:2001:db8:0:0::/64");
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
  });

  it("ignores a self-written CF-Connecting-IP on a WireGuard-only deployment", async () => {
    vi.stubEnv("PORTAL_ALLOW_PUBLIC_EDGE", "");
    const { clientAddress } = await load();

    const a = clientAddress(headers({ "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "10.42.0.5" }));
    const b = clientAddress(headers({ "cf-connecting-ip": "198.51.100.2", "x-forwarded-for": "10.42.0.5" }));

    expect(a).toBe("10.42.0.5");
    expect(b).toBe(a);
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

describe("addressKey", () => {
  it("keeps IPv4 addresses whole", async () => {
    const { addressKey } = await load();
    expect(addressKey("203.0.113.7")).toBe("203.0.113.7");
  });

  it("counts every address in one IPv6 /64 as the same client", async () => {
    const { addressKey } = await load();

    const a = addressKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd");
    expect(addressKey("2001:db8:1:2::1")).toBe(a);
    expect(addressKey("2001:0DB8:0001:0002:ffff:0:0:1")).toBe(a);
    expect(a).toBe("2001:db8:1:2::/64");
  });

  it("keeps different /64s apart", async () => {
    const { addressKey } = await load();
    expect(addressKey("2001:db8:1:2::1")).not.toBe(addressKey("2001:db8:1:3::1"));
  });

  it("handles compressed forms and v4-mapped addresses", async () => {
    const { addressKey } = await load();

    expect(addressKey("::1")).toBe("0:0:0:0::/64");
    expect(addressKey("2001:db8::")).toBe("2001:db8:0:0::/64");
    expect(addressKey("::ffff:198.51.100.4")).toBe("198.51.100.4");
  });

  it("buckets a rotating IPv6 client together on the public path", async () => {
    vi.stubEnv("PORTAL_ALLOW_PUBLIC_EDGE", "true");
    const { clientAddress } = await load();
    const key = (ip: string) => clientAddress(new Headers({ "cf-connecting-ip": ip }));

    expect(key("2001:db8:5:6::1")).toBe(key("2001:db8:5:6:dead:beef:0:42"));
    vi.unstubAllEnvs();
  });
});
