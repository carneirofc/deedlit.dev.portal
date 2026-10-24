import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalServiceApp } from "@/features/services/types";
import {
  cardUrl,
  dedupeByHost,
  getJson,
  MAX_SERVICE_LINKS,
  parseLinks,
  resolveLinkUrl,
  isAllowedHost,
  isValidDnsLabel,
  parseHealthPath,
  parsePort,
  toServiceApp
} from "./discover";

describe("annotation parsers", () => {
  it.each(["//x", "/../x", "http://x", "/a b", "/a#b", "x", "/a\\b"])(
    "parseHealthPath rejects %s back to /",
    (raw) => {
      expect(parseHealthPath(raw)).toBe("/");
    }
  );

  it("parseHealthPath accepts a simple path with a query", () => {
    expect(parseHealthPath("/healthz?full=1")).toBe("/healthz?full=1");
  });

  it.each(["0", "65536", "80abc", "-1", "8.5", " 80", ""])("parsePort rejects %j", (raw) => {
    expect(parsePort(raw, undefined)).toBeUndefined();
  });

  it("parsePort accepts a port and otherwise keeps the fallback", () => {
    expect(parsePort("9000", 80)).toBe(9000);
    expect(parsePort("nope", 80)).toBe(80);
  });

  it("isValidDnsLabel follows RFC 1123", () => {
    expect(isValidDnsLabel("my-svc")).toBe(true);
    expect(isValidDnsLabel("-bad")).toBe(false);
    expect(isValidDnsLabel("a.b")).toBe(false);
    expect(isValidDnsLabel("a".repeat(64))).toBe(false);
  });
});

describe("isAllowedHost", () => {
  const suffixes = ["deedlit.dev"];

  it.each([
    ["deedlit.dev", true],
    ["auth.deedlit.dev", true],
    ["a.b.deedlit.dev", true],
    ["login.evil.example", false],
    ["xdeedlit.dev", false],
    ["deedlit.dev.evil.example", false],
    ["*.deedlit.dev", false],
    ["a..deedlit.dev", false],
    ["auth.deedlit.dev/path", false]
  ])("%s → %s", (host, allowed) => {
    expect(isAllowedHost(host, suffixes)).toBe(allowed);
  });
});

describe("toServiceApp", () => {
  beforeEach(() => vi.stubEnv("PORTAL_ALLOWED_HOST_SUFFIXES", ""));

  const ingress = (overrides: { host?: string; annotations?: Record<string, string> } = {}) => ({
    metadata: {
      name: "registry",
      namespace: "zot",
      uid: "uid-1",
      annotations: overrides.annotations ?? {}
    },
    spec: {
      rules: [
        {
          host: overrides.host ?? "registry.deedlit.dev",
          http: { paths: [{ backend: { service: { name: "zot", port: { number: 5000 } } } }] }
        }
      ]
    }
  });

  it("builds the probe URL from validated parts only", () => {
    const app = toServiceApp(
      ingress({ annotations: { "portal.deedlit.dev/health-path": "//evil.example/x" } }),
      new Map()
    );

    expect(app?.probeUrl).toBe("http://zot.zot.svc.cluster.local:5000/");
    expect(app?.namespace).toBe("zot");
  });

  it("keeps the bare-host URL and omits links when neither is annotated", () => {
    const app = toServiceApp(ingress(), new Map());
    expect(app?.url).toBe("https://registry.deedlit.dev");
    expect(app).not.toHaveProperty("links");
  });

  it("applies portal.deedlit.dev/path and /links (Keycloak's real annotations)", () => {
    const app = toServiceApp(
      ingress({
        host: "auth.deedlit.dev",
        annotations: {
          "portal.deedlit.dev/path": "/realms/deedlit/account",
          "portal.deedlit.dev/links": JSON.stringify([
            { label: "OIDC issuer", url: "/realms/deedlit" },
            { label: "OIDC discovery", url: "/realms/deedlit/.well-known/openid-configuration" },
            { label: "Admin console (WireGuard)", url: "https://auth-admin.deedlit.dev/admin/" }
          ])
        }
      }),
      new Map()
    );

    expect(app?.url).toBe("https://auth.deedlit.dev/realms/deedlit/account");
    expect(app?.links).toEqual([
      { label: "OIDC issuer", url: "https://auth.deedlit.dev/realms/deedlit" },
      {
        label: "OIDC discovery",
        url: "https://auth.deedlit.dev/realms/deedlit/.well-known/openid-configuration"
      },
      { label: "Admin console (WireGuard)", url: "https://auth-admin.deedlit.dev/admin/" }
    ]);
  });

  it("drops an Ingress whose host is off the allowed domain", () => {
    expect(toServiceApp(ingress({ host: "keycloak-login.evil.example" }), new Map())).toBeNull();
  });

  it("honours PORTAL_ALLOWED_HOST_SUFFIXES", () => {
    vi.stubEnv("PORTAL_ALLOWED_HOST_SUFFIXES", "example.org, .lan");
    expect(toServiceApp(ingress({ host: "nas.lan" }), new Map())).not.toBeNull();
    expect(toServiceApp(ingress({ host: "registry.deedlit.dev" }), new Map())).toBeNull();
  });
});

describe("cardUrl", () => {
  it("is the bare host without a path", () => {
    expect(cardUrl("auth.deedlit.dev", undefined)).toBe("https://auth.deedlit.dev");
    expect(cardUrl("auth.deedlit.dev", "/")).toBe("https://auth.deedlit.dev");
  });

  it("appends a valid path", () => {
    expect(cardUrl("auth.deedlit.dev", "/realms/deedlit/account")).toBe(
      "https://auth.deedlit.dev/realms/deedlit/account"
    );
  });

  it.each(["//evil.example", "/../x", "https://evil.example", "x"])(
    "keeps the bare host for %s",
    (raw) => {
      expect(cardUrl("auth.deedlit.dev", raw)).toBe("https://auth.deedlit.dev");
    }
  );
});

describe("resolveLinkUrl", () => {
  const suffixes = ["deedlit.dev"];

  it("resolves a path against the card host", () => {
    expect(resolveLinkUrl("/realms/deedlit", "auth.deedlit.dev", suffixes)).toBe(
      "https://auth.deedlit.dev/realms/deedlit"
    );
  });

  it("accepts an https URL on an allowed host", () => {
    expect(resolveLinkUrl("https://auth-admin.deedlit.dev/admin/", "auth.deedlit.dev", suffixes)).toBe(
      "https://auth-admin.deedlit.dev/admin/"
    );
  });

  it.each([
    "http://auth-admin.deedlit.dev/",
    "https://evil.example/",
    "https://xdeedlit.dev/",
    "https://user:pw@auth.deedlit.dev/",
    "https://auth.deedlit.dev:8443/",
    "javascript:alert(1)",
    "//evil.example/x",
    "/../x",
    "not a url"
  ])("refuses %s", (raw) => {
    expect(resolveLinkUrl(raw, "auth.deedlit.dev", suffixes)).toBeNull();
  });
});

describe("parseLinks", () => {
  const suffixes = ["deedlit.dev"];
  const parse = (raw: string | undefined) => parseLinks(raw, "auth.deedlit.dev", suffixes, "ns/ing");

  it("returns nothing for absent, malformed or non-array input", () => {
    expect(parse(undefined)).toEqual([]);
    expect(parse("{not json")).toEqual([]);
    expect(parse('{"label":"x","url":"/x"}')).toEqual([]);
  });

  it("keeps valid entries and drops bad ones", () => {
    const raw = JSON.stringify([
      { label: "OIDC issuer", url: "/realms/deedlit" },
      { label: "Phish", url: "https://evil.example/" },
      { label: "", url: "/x" },
      { url: "/x" },
      null,
      { label: "Admin", url: "https://auth-admin.deedlit.dev/admin/" }
    ]);
    expect(parse(raw)).toEqual([
      { label: "OIDC issuer", url: "https://auth.deedlit.dev/realms/deedlit" },
      { label: "Admin", url: "https://auth-admin.deedlit.dev/admin/" }
    ]);
  });

  it("strips control characters and caps the label length", () => {
    const [link] = parse(JSON.stringify([{ label: ` a\u0000b\n${"c".repeat(80)}`, url: "/x" }]));
    expect(link.label.startsWith("ab")).toBe(true);
    expect(link.label).toHaveLength(48);
  });

  it(`keeps at most ${MAX_SERVICE_LINKS} links`, () => {
    const raw = JSON.stringify(Array.from({ length: 12 }, (_, i) => ({ label: `L${i}`, url: `/p${i}` })));
    expect(parse(raw)).toHaveLength(MAX_SERVICE_LINKS);
  });
});

describe("dedupeByHost", () => {
  const app = (id: string, host: string): LocalServiceApp => ({
    id,
    name: id,
    host,
    url: `https://${host}`,
    description: "",
    category: "other",
    icon: "generic",
    order: 0
  });

  it("keeps one card per host, the first listed", () => {
    const result = dedupeByHost([
      app("real", "auth.deedlit.dev"),
      app("copy", "AUTH.deedlit.dev"),
      app("other", "s3.deedlit.dev")
    ]);

    expect(result.map((entry) => entry.id)).toEqual(["real", "other"]);
  });
});

describe("getJson always settles", () => {
  let dir: string;
  let ca: string;
  let server: Server;
  let url: string;
  let handler: (req: unknown, res: import("node:http").ServerResponse) => void = () => {};

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "portal-getjson-"));
    const selfSigned = (name: string) =>
      execFileSync(
        "openssl",
        [
          "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1",
          "-nodes", "-days", "1", "-subj", "/CN=127.0.0.1",
          "-addext", "subjectAltName=IP:127.0.0.1",
          "-keyout", join(dir, `${name}.key`), "-out", join(dir, `${name}.pem`)
        ],
        { stdio: "ignore" }
      );
    selfSigned("server");
    selfSigned("other");
    ca = readFileSync(join(dir, "server.pem"), "utf8");

    server = createServer(
      { key: readFileSync(join(dir, "server.key")), cert: ca },
      (req, res) => handler(req, res)
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `https://127.0.0.1:${(server.address() as AddressInfo).port}/x`;
  });

  afterAll(() => {
    server.closeAllConnections();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const credentials = () => ({ token: "t", ca });

  it("resolves a complete response", async () => {
    handler = (_req, res) => res.end('{"items":[]}');
    await expect(getJson(url, credentials())).resolves.toEqual({ status: 200, body: '{"items":[]}' });
  });

  it("rejects when the peer dies mid-body", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "Content-Length": "100" });
      res.write("{\"items\":");
      setTimeout(() => res.socket?.destroy(), 20);
    };
    await expect(getJson(url, credentials(), { deadlineMs: 2_000 })).rejects.toThrow();
  });

  it("rejects a slow-loris response at the deadline, not the idle timeout", async () => {
    handler = (_req, res) => {
      res.writeHead(200);
      const timer = setInterval(() => res.write(" "), 50);
      res.on("close", () => clearInterval(timer));
    };
    const started = Date.now();
    await expect(getJson(url, credentials(), { deadlineMs: 300 })).rejects.toThrow(/300ms/);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("rejects an oversized response", async () => {
    handler = (_req, res) => res.end(Buffer.alloc(3 * 1024 * 1024, 0x20));
    await expect(getJson(url, credentials(), { deadlineMs: 5_000 })).rejects.toThrow(/exceeded/);
  });

  it("refuses a server not signed by the pinned CA", async () => {
    handler = (_req, res) => res.end("{}");
    const other = readFileSync(join(dir, "other.pem"), "utf8");
    await expect(getJson(url, { token: "t", ca: other })).rejects.toThrow(/self[- ]signed|verify/i);
  });
});
