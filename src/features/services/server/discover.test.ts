import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getJson, isValidDnsLabel, parseHealthPath, parsePort } from "./discover";

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
