import type {
  HealthState,
  LocalServiceApp,
  ServiceCategory,
  ServiceHealthMap
} from "@/features/services/types";

/**
 * Pure presentation logic for the dashboard: counts, grouping and filtering.
 * Kept out of the components so it can be tested without a DOM.
 */

export const CATEGORY_LABEL: Record<ServiceCategory, string> = {
  ops: "Operations",
  workflow: "Workflows & AI",
  media: "Media & reading",
  archive: "Archives",
  storage: "Storage",
  auth: "Identity",
  other: "Other"
};

/** Display order of the category sections. */
const CATEGORY_ORDER: readonly ServiceCategory[] = [
  "ops",
  "workflow",
  "media",
  "archive",
  "storage",
  "auth",
  "other"
];

export interface ServiceSummary {
  total: number;
  up: number;
  down: number;
  unknown: number;
  /** Median probe round-trip of the services that answered; null when none did. */
  medianResponseMs: number | null;
}

export function stateOf(health: ServiceHealthMap, id: string): HealthState {
  return health[id]?.state ?? "unknown";
}

export function summarize(apps: LocalServiceApp[], health: ServiceHealthMap): ServiceSummary {
  const counts = { up: 0, down: 0, unknown: 0 };
  const times: number[] = [];

  for (const app of apps) {
    const entry = health[app.id];
    const state = entry?.state ?? "unknown";
    counts[state] += 1;
    if (state === "up" && typeof entry?.responseTime === "number") times.push(entry.responseTime);
  }

  times.sort((a, b) => a - b);
  const mid = Math.floor(times.length / 2);
  const median =
    times.length === 0
      ? null
      : times.length % 2
        ? times[mid]
        : Math.round((times[mid - 1] + times[mid]) / 2);

  return { total: apps.length, ...counts, medianResponseMs: median };
}

export type StatusFilter = "all" | HealthState;

export function filterServices(
  apps: LocalServiceApp[],
  health: ServiceHealthMap,
  query: string,
  status: StatusFilter
): LocalServiceApp[] {
  const needle = query.trim().toLowerCase();

  return apps.filter((app) => {
    if (status !== "all" && stateOf(health, app.id) !== status) return false;
    if (!needle) return true;
    const haystack = [
      app.name,
      app.host,
      app.namespace ?? "",
      app.category,
      CATEGORY_LABEL[app.category] ?? "",
      app.description,
      ...(app.links ?? []).map((link) => link.label)
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}

export interface CategoryGroup {
  category: ServiceCategory;
  label: string;
  apps: LocalServiceApp[];
}

/**
 * Groups by category in a fixed order, keeping the incoming order (the
 * `portal.deedlit.dev/order` sort from discovery) within each group. Empty
 * groups are dropped.
 */
export function groupByCategory(apps: LocalServiceApp[]): CategoryGroup[] {
  const buckets = new Map<ServiceCategory, LocalServiceApp[]>();
  for (const app of apps) {
    const category = CATEGORY_ORDER.includes(app.category) ? app.category : "other";
    const bucket = buckets.get(category) ?? [];
    bucket.push(app);
    buckets.set(category, bucket);
  }

  return CATEGORY_ORDER.filter((category) => buckets.has(category)).map((category) => ({
    category,
    label: CATEGORY_LABEL[category],
    apps: buckets.get(category) ?? []
  }));
}
