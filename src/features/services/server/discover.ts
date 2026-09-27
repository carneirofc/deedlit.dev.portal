import { readFile } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import { logger } from "@/lib/logger";
import {
  PORTAL_ANNOTATIONS,
  PORTAL_EXPOSE_LABEL,
  SERVICE_CATEGORIES,
  SERVICE_ICONS,
  type DiscoveryFailure,
  type LocalServiceApp,
  type ServiceCategory,
  type ServiceIcon
} from "@/features/services/types";
import { localServiceApps } from "@/features/services/data/local-services";

/**
 * Discovers the portal's service list from the Kubernetes API.
 *
 * The portal reads Ingress objects labelled `app.deedlit.dev/expose=true` and
 * takes their display metadata from `portal.deedlit.dev/*` annotations, so
 * adding a service to the portal is a values-file change in the infra repo —
 * no rebuild here.
 *
 * A single GET against one API group is the whole requirement, so this talks
 * to the apiserver with `fetch` rather than pulling in `@kubernetes/client-node`,
 * which would add megabytes to the standalone bundle for no gain.
 *
 * The read surface is deliberately two verbs and nothing more: `list` on
 * label-selected Ingresses, and `get` on the individual Services those
 * Ingresses name. The portal never enumerates Services, never reads Pods,
 * Secrets or ConfigMaps, and never writes anything — so the worst a bug here
 * can leak is what is already on a portal-exposed Ingress. Keep the RBAC in
 * `deedlit.dev.infra` matched to that; see the README.
 */

const SA_DIR = "/var/run/secrets/kubernetes.io/serviceaccount";
const TOKEN_PATH = `${SA_DIR}/token`;
const CA_PATH = `${SA_DIR}/ca.crt`;
/** Socket-idle timeout: no bytes for this long and the request is abandoned. */
const API_TIMEOUT_MS = 5_000;

/**
 * Hard ceiling on one apiserver exchange, from dialling to the last byte. The
 * idle timeout alone is not a deadline — a peer trickling a byte every few
 * seconds would keep a request, and every portal reader waiting on it, alive
 * indefinitely.
 */
export const API_DEADLINE_MS = 6_000;

/**
 * Nothing the portal reads is large — a few dozen Ingresses is under 200 KB.
 * The cap exists so a surprising response (or a wrong URL pointed at a
 * streaming endpoint) cannot grow the buffer until the pod is OOM-killed.
 */
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/**
 * Upper bound on the per-refresh Service reads. Only named-port backends need
 * one, so this is generous; it bounds the fan-out at the apiserver if the
 * exposed-Ingress set ever grows unexpectedly.
 */
const MAX_PORT_LOOKUPS = 32;

const API_HOST =
  process.env.KUBERNETES_SERVICE_HOST && process.env.KUBERNETES_SERVICE_PORT
    ? `https://${process.env.KUBERNETES_SERVICE_HOST}:${process.env.KUBERNETES_SERVICE_PORT}`
    : "https://kubernetes.default.svc";

interface IngressBackendService {
  name?: string;
  port?: { number?: number; name?: string };
}

interface ServiceResponse {
  spec?: { ports?: Array<{ name?: string; port?: number }> };
}

interface IngressListResponse {
  items?: Array<{
    metadata?: {
      name?: string;
      namespace?: string;
      uid?: string;
      annotations?: Record<string, string>;
    };
    spec?: {
      rules?: Array<{
        host?: string;
        http?: { paths?: Array<{ backend?: { service?: IngressBackendService } }> };
      }>;
    };
  }>;
}

async function readClusterCredentials(): Promise<{ token: string; ca: string } | null> {
  try {
    const [token, ca] = await Promise.all([
      readFile(TOKEN_PATH, "utf8"),
      readFile(CA_PATH, "utf8")
    ]);

    return { token: token.trim(), ca };
  } catch {
    return null;
  }
}

/**
 * `fetch` has no way to pin a CA per request, and the apiserver certificate is
 * signed by the cluster's own root — so this one call drops to `node:https`
 * rather than disabling verification or leaning on a `NODE_EXTRA_CA_CERTS`
 * env var that a deployment could forget to set.
 *
 * This request carries the pod's ServiceAccount token, which is the most
 * valuable credential the portal holds, so the transport is where it has to be
 * protected. Verification is on (the default), the trust anchor is the
 * cluster CA read from the projected volume rather than the system store, and
 * TLS 1.2 is the floor — a downgrade to a broken suite is the cheap way to
 * make a "verified" connection readable. There is deliberately no way to turn
 * any of that off from configuration: an `AUTH_SKIP_TLS_VERIFY`-style escape
 * hatch is the one setting that reliably ends up true in production.
 */
/** `10.96.0.1` or `[::1]` — anything that is an address rather than a name. */
function isIpLiteral(hostname: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
}

/**
 * Settles exactly once, always, within `API_DEADLINE_MS`.
 *
 * Once a response has started, a peer reset or a mid-body close is reported
 * on the *response* stream — sometimes as `error`, sometimes only as `aborted`
 * or a `close` without `end`. Unhandled, the first crashes the process and the
 * others leave the promise pending forever, which wedges the portal snapshot
 * that waits on it. Every one of those paths funnels into `fail` here.
 */
export function getJson(
  url: string,
  { token, ca }: { token: string; ca: string },
  { deadlineMs = API_DEADLINE_MS }: { deadlineMs?: number } = {}
): Promise<{ status: number; body: string }> {
  const target = new URL(url);

  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (settle: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      settle();
    };
    const fail = (error: Error) =>
      done(() => {
        req.destroy();
        reject(error);
      });

    const deadline = setTimeout(
      () => fail(new Error(`No complete response within ${deadlineMs}ms`)),
      deadlineMs
    );

    const req = httpsRequest(
      {
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        method: "GET",
        ca,
        // Trust *only* the cluster CA: a public CA that mis-issues for this
        // name is not an acceptable signer for the apiserver.
        rejectUnauthorized: true,
        minVersion: "TLSv1.2",
        // `KUBERNETES_SERVICE_HOST` is normally an IP, and RFC 6066 forbids an
        // IP in SNI, so it is sent only for a real name. Either way the
        // certificate is still checked against the host being dialled.
        ...(isIpLiteral(target.hostname) ? {} : { servername: target.hostname }),
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        timeout: API_TIMEOUT_MS
      },
      (res) => {
        // Buffers, not strings: a multi-byte character split across chunks
        // stays intact, and the byte count is exact.
        const chunks: Buffer[] = [];
        let bytes = 0;

        res.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > MAX_RESPONSE_BYTES) {
            fail(new Error(`Response exceeded ${MAX_RESPONSE_BYTES} bytes`));
            return;
          }
          chunks.push(chunk);
        });
        res.on("error", fail);
        res.on("aborted", () => fail(new Error("Response aborted")));
        res.on("close", () => {
          if (!res.complete) fail(new Error("Response closed before it completed"));
        });
        res.on("end", () =>
          done(() =>
            resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") })
          )
        );
      }
    );

    req.on("timeout", () => fail(new Error(`Idle for ${API_TIMEOUT_MS}ms`)));
    req.on("error", fail);
    req.end();
  });
}

function pickAnnotation(
  annotations: Record<string, string> | undefined,
  key: string
): string | undefined {
  const value = annotations?.[key]?.trim();
  return value ? value : undefined;
}

function parseIcon(raw: string | undefined): ServiceIcon {
  return SERVICE_ICONS.includes(raw as ServiceIcon) ? (raw as ServiceIcon) : "generic";
}

function parseCategory(raw: string | undefined): ServiceCategory {
  return SERVICE_CATEGORIES.includes(raw as ServiceCategory)
    ? (raw as ServiceCategory)
    : "other";
}

function parseOrder(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) ? parsed : 100;
}

/**
 * Annotations are operator-supplied strings, so the probe path is validated
 * rather than trusted: it must be a simple absolute path. Anything with a
 * scheme, an authority (`//host`), or traversal is rejected back to "/" —
 * this is what stops an annotation from redirecting the prober at an
 * arbitrary target.
 */
export function parseHealthPath(raw: string | undefined): string {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("..")) return "/";
  if (/[^\w\-./~%?=&]/.test(raw)) return "/";
  return raw;
}

export function parsePort(raw: string | undefined, fallback: number | undefined): number | undefined {
  // Digits only: `parseInt("80abc")` is 80, and a malformed annotation should
  // fall back rather than be half-read.
  if (!raw || !/^\d{1,5}$/.test(raw)) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536) return parsed;
  return fallback;
}

/** RFC 1123 label check — namespace and service names are used to build a URL. */
export function isValidDnsLabel(value: string | undefined): value is string {
  return !!value && /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(value) && value.length <= 63;
}

/**
 * Ingress backends usually name their port (`api`, `console`, `http`) rather
 * than numbering it, and a name cannot be dialled. This maps
 * `namespace/service` → { portName → number } so a named backend can still be
 * probed.
 *
 * These are read one Service at a time, by name, rather than by listing every
 * Service in the cluster. The list call was one line shorter but needed `list`
 * on Services cluster-wide — the verb that turns a read-only bug or a stolen
 * token into an inventory of every workload, port and Service annotation in
 * the cluster. Reading only the names an exposed Ingress already points at
 * needs `get`, which discloses nothing the portal was not told about.
 */
type PortLookup = Map<string, Map<string, number>>;

interface ServiceRef {
  namespace: string;
  name: string;
}

/** The backends whose port is a name; a numbered backend needs no lookup. */
function namedPortBackends(body: IngressListResponse): ServiceRef[] {
  const refs = new Map<string, ServiceRef>();

  for (const item of body.items ?? []) {
    const namespace = item.metadata?.namespace;
    if (!isValidDnsLabel(namespace)) continue;

    for (const rule of item.spec?.rules ?? []) {
      for (const path of rule.http?.paths ?? []) {
        const backend = path.backend?.service;
        if (!backend?.port?.name) continue;
        if (!isValidDnsLabel(backend.name)) continue;

        refs.set(`${namespace}/${backend.name}`, { namespace, name: backend.name });
      }
    }
  }

  return [...refs.values()].slice(0, MAX_PORT_LOOKUPS);
}

async function resolveNamedPorts(
  refs: ServiceRef[],
  credentials: { token: string; ca: string }
): Promise<PortLookup> {
  const lookup: PortLookup = new Map();
  if (!refs.length) return lookup;

  // Both components are validated DNS labels, so the path cannot be escaped.
  const results = await Promise.all(
    refs.map(async (ref) => {
      const url = `${API_HOST}/api/v1/namespaces/${ref.namespace}/services/${ref.name}`;

      try {
        const response = await getJson(url, credentials);
        if (response.status < 200 || response.status >= 300) {
          logger.warn("Portal service lookup failed; set portal.deedlit.dev/health-port", {
            service: `${ref.namespace}/${ref.name}`,
            status: response.status
          });
          return null;
        }
        return { ref, body: JSON.parse(response.body) as ServiceResponse };
      } catch (error) {
        logger.warn("Portal service lookup threw", {
          service: `${ref.namespace}/${ref.name}`,
          reason: error instanceof Error ? error.message : "unknown error"
        });
        return null;
      }
    })
  );

  for (const result of results) {
    if (!result) continue;

    const ports = new Map<string, number>();
    for (const port of result.body.spec?.ports ?? []) {
      if (port.name && typeof port.port === "number") ports.set(port.name, port.port);
    }

    lookup.set(`${result.ref.namespace}/${result.ref.name}`, ports);
  }

  return lookup;
}

function toServiceApp(
  item: NonNullable<IngressListResponse["items"]>[number],
  portLookup: PortLookup
): LocalServiceApp | null {
  const namespace = item.metadata?.namespace;
  const ingressName = item.metadata?.name;
  const annotations = item.metadata?.annotations;

  const rule = item.spec?.rules?.find((candidate) => candidate.host);
  const host = rule?.host;
  if (!host || !ingressName || !isValidDnsLabel(namespace)) return null;

  const backend = rule?.http?.paths?.find((path) => path.backend?.service?.name)?.backend?.service;
  const backendName = backend?.name;

  // Prefer an explicit number, then resolve a named port through the Service,
  // and let the annotation override either.
  const namedPort =
    backend?.port?.name && backendName
      ? portLookup.get(`${namespace}/${backendName}`)?.get(backend.port.name)
      : undefined;

  const port = parsePort(
    pickAnnotation(annotations, PORTAL_ANNOTATIONS.healthPort),
    backend?.port?.number ?? namedPort
  );

  // Built entirely from validated components — never from a raw annotation.
  const probeUrl =
    isValidDnsLabel(backendName) && port
      ? `http://${backendName}.${namespace}.svc.cluster.local:${port}${parseHealthPath(
          pickAnnotation(annotations, PORTAL_ANNOTATIONS.healthPath)
        )}`
      : undefined;

  return {
    id: item.metadata?.uid ?? `${namespace}/${ingressName}`,
    name: pickAnnotation(annotations, PORTAL_ANNOTATIONS.name) ?? ingressName,
    host,
    url: `https://${host}`,
    description:
      pickAnnotation(annotations, PORTAL_ANNOTATIONS.description) ?? `Ingress in ${namespace}.`,
    status: "online",
    category: parseCategory(pickAnnotation(annotations, PORTAL_ANNOTATIONS.category)),
    icon: parseIcon(pickAnnotation(annotations, PORTAL_ANNOTATIONS.icon)),
    order: parseOrder(pickAnnotation(annotations, PORTAL_ANNOTATIONS.order)),
    probeUrl
  };
}

export type DiscoveryResult =
  | { ok: true; apps: LocalServiceApp[]; source: "cluster" | "static" }
  | { ok: false; reason: DiscoveryFailure };

function failureForStatus(status: number): DiscoveryFailure {
  if (status === 401) return "unauthenticated";
  if (status === 403) return "rbac";
  return "unreachable";
}

/**
 * Returns every portal-exposed service, or says why it could not.
 *
 * Failure is explicit rather than an empty list: an RBAC regression or an
 * expired token must not look like "nothing is labelled", because the natural
 * "fix" for that is to grant more — the opposite of the real cause.
 *
 * Outside the cluster (local `next dev`) there is no ServiceAccount token, so
 * the static list is used instead and the feature stays developable on a
 * laptop.
 */
export async function discoverServices(): Promise<DiscoveryResult> {
  const credentials = await readClusterCredentials();
  if (!credentials) {
    logger.debug("No Kubernetes ServiceAccount token; using the static service list");
    return { ok: true, apps: [...localServiceApps].sort(byOrderThenName), source: "static" };
  }

  const selector = encodeURIComponent(`${PORTAL_EXPOSE_LABEL}=true`);
  const ingressUrl = `${API_HOST}/apis/networking.k8s.io/v1/ingresses?labelSelector=${selector}`;

  let ingressResponse: { status: number; body: string };
  try {
    ingressResponse = await getJson(ingressUrl, credentials);
  } catch (error) {
    logger.error("Kubernetes ingress discovery threw", {
      reason: error instanceof Error ? error.message : "unknown error"
    });
    return { ok: false, reason: "unreachable" };
  }

  if (ingressResponse.status < 200 || ingressResponse.status >= 300) {
    const reason = failureForStatus(ingressResponse.status);
    logger.error("Kubernetes ingress discovery failed", { status: ingressResponse.status, reason });
    return { ok: false, reason };
  }

  let body: IngressListResponse;
  try {
    body = JSON.parse(ingressResponse.body) as IngressListResponse;
  } catch (error) {
    logger.error("Kubernetes ingress discovery returned unparseable JSON", {
      reason: error instanceof Error ? error.message : "unknown error"
    });
    return { ok: false, reason: "invalid-response" };
  }

  // A failure in here is not fatal: without it, named-port backends simply
  // get no probe URL and render as "unknown" rather than the page failing.
  const portLookup = await resolveNamedPorts(namedPortBackends(body), credentials);

  const services = (body.items ?? [])
    .map((item) => toServiceApp(item, portLookup))
    .filter((service): service is LocalServiceApp => service !== null);

  logger.info(`Discovered ${services.length} portal services from Kubernetes`);
  return { ok: true, apps: services.sort(byOrderThenName), source: "cluster" };
}

function byOrderThenName(a: LocalServiceApp, b: LocalServiceApp): number {
  return a.order - b.order || a.name.localeCompare(b.name);
}
