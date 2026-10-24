export type ServiceIcon =
  | "gallery"
  | "prompt"
  | "metrics"
  | "comfyui"
  | "searnime"
  | "files"
  | "idp"
  | "database"
  | "storage"
  | "registry"
  | "books"
  | "generic";

export const SERVICE_ICONS: readonly ServiceIcon[] = [
  "gallery",
  "prompt",
  "metrics",
  "comfyui",
  "searnime",
  "files",
  "idp",
  "database",
  "storage",
  "registry",
  "books",
  "generic"
];

export type ServiceCategory =
  | "archive"
  | "workflow"
  | "ops"
  | "storage"
  | "auth"
  | "media"
  | "other";

export const SERVICE_CATEGORIES: readonly ServiceCategory[] = [
  "archive",
  "workflow",
  "ops",
  "storage",
  "auth",
  "media",
  "other"
];

/**
 * An extra address a card advertises besides its main link — e.g. an OIDC
 * issuer URL to paste into a client, or an admin console on another host.
 */
export interface ServiceLink {
  label: string;
  /** Absolute `https://` URL, already validated against the allowed hosts. */
  url: string;
}

export interface LocalServiceApp {
  id: string;
  name: string;
  host: string;
  /** Where the card's title links: `https://<host>` plus `portal.deedlit.dev/path`. */
  url: string;
  /** Extra addresses from `portal.deedlit.dev/links`; absent when there are none. */
  links?: ServiceLink[];
  description: string;
  /** Namespace of the Ingress it was discovered from; absent for the static list. */
  namespace?: string;
  category: ServiceCategory;
  icon: ServiceIcon;
  /** Sort weight from the `portal.deedlit.dev/order` annotation. */
  order: number;
  /**
   * In-cluster address to probe, e.g.
   * `http://rustfs.rustfs.svc.cluster.local:9000/health`. Absent when the
   * service was not discovered from Kubernetes (local dev fallback).
   */
  probeUrl?: string;
}

export type HealthState = "up" | "down" | "unknown";

export interface ServiceHealth {
  state: HealthState;
  /** Round-trip time of the probe, in milliseconds. */
  responseTime?: number;
  /** Short, non-sensitive reason when `state` is not "up". */
  detail?: string;
  checkedAt: string;
}

export type ServiceHealthMap = Record<string, ServiceHealth>;

/**
 * Why service discovery failed, as a closed set. Only this enum ever reaches
 * the browser — raw apiserver bodies and error messages stay in the logs.
 *
 * - `unauthenticated`: the apiserver answered 401 (expired or wrong token).
 * - `rbac`: 403 — the ClusterRole no longer grants what discovery needs.
 * - `unreachable`: no usable answer (network error, timeout, 5xx, other status).
 * - `invalid-response`: a 2xx whose body could not be parsed.
 */
export type DiscoveryFailure = "rbac" | "unauthenticated" | "unreachable" | "invalid-response";

/**
 * What the refresh action reports back. `refreshed: false` means the limit was
 * hit and the page re-rendered from cache — without saying so, a no-op looks
 * exactly like a successful re-probe. `null` before the first submit.
 */
export interface RefreshState {
  refreshed: boolean | null;
}

/**
 * The contract an Ingress uses to advertise itself to this portal.
 *
 * A chart in `deedlit.dev.infra` opts in with the label and then describes
 * itself with the annotations; nothing here is inferred from the Ingress name
 * except as a fallback.
 */
export const PORTAL_EXPOSE_LABEL = "app.deedlit.dev/expose";

export const PORTAL_ANNOTATIONS = {
  name: "portal.deedlit.dev/name",
  description: "portal.deedlit.dev/description",
  category: "portal.deedlit.dev/category",
  icon: "portal.deedlit.dev/icon",
  healthPath: "portal.deedlit.dev/health-path",
  healthPort: "portal.deedlit.dev/health-port",
  order: "portal.deedlit.dev/order",
  /** Path appended to the host for the card's main link (default: none). */
  path: "portal.deedlit.dev/path",
  /** JSON array of `{ "label", "url" }`; `url` is a path on the host or an https URL. */
  links: "portal.deedlit.dev/links"
} as const;
