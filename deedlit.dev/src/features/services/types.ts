export type ServiceStatus = "online" | "degraded" | "offline";

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

export interface LocalServiceApp {
  id: string;
  name: string;
  host: string;
  url: string;
  description: string;
  status: ServiceStatus;
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
  order: "portal.deedlit.dev/order"
} as const;
