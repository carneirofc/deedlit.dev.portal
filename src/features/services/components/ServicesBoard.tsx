"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FiSearch } from "react-icons/fi";
import { StatusBanner } from "@carneirofc/ui";
import { RelativeTime } from "@/components/RelativeTime";
import { RefreshButton } from "@/features/services/components/RefreshButton";
import { ServiceCard } from "@/features/services/components/ServiceCard";
import {
  COPY_FEEDBACK_MS,
  type CopyFeedback,
  copyToClipboard
} from "@/features/services/lib/copy-feedback";
import {
  filterServices,
  groupByCategory,
  type StatusFilter,
  summarize
} from "@/features/services/lib/summary";
import type {
  DiscoveryFailure,
  LocalServiceApp,
  RefreshState,
  ServiceHealthMap
} from "@/features/services/types";

interface ServicesBoardProps {
  apps: LocalServiceApp[];
  health: ServiceHealthMap;
  /** When the probes behind `health` ran. */
  collectedAt: string;
  /** Set when discovery is failing and this is the last good view (or none). */
  degraded?: { reason: DiscoveryFailure; since: string; servingLastGood: boolean };
  /** Server action: re-probes (unless rate-limited) and revalidates the page. */
  refreshAction: (previous: RefreshState) => Promise<RefreshState>;
}

const FAILURE_LABEL: Record<DiscoveryFailure, string> = {
  rbac: "permission denied by the Kubernetes API",
  unauthenticated: "the service account token was rejected",
  unreachable: "the Kubernetes API is unreachable",
  "invalid-response": "the Kubernetes API returned an unreadable response"
};

/**
 * Search, status filter and the grouped grid.
 *
 * Discovery and health probing both happen on the server and arrive as props,
 * so the first paint already carries real statuses — there is no client-side
 * probing (which CORS made impossible anyway). This is a client component only
 * for the filters, the clipboard buttons and the refresh feedback.
 */
export function ServicesBoard({
  apps,
  health,
  collectedAt,
  degraded,
  refreshAction
}: ServicesBoardProps) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const summary = useMemo(() => summarize(apps, health), [apps, health]);
  const groups = useMemo(
    () => groupByCategory(filterServices(apps, health, query, status)),
    [apps, health, query, status]
  );
  const shown = groups.reduce((sum, group) => sum + group.apps.length, 0);

  // The copy buttons are siblings of the card's link, not inside it, so a
  // click here can never also open the service. One result at a time: a new
  // copy replaces the last one, on its own button, and restarts the timer.
  const copyValue = async (value: string, what: string) => {
    const feedback = await copyToClipboard(value, what, navigator.clipboard);
    setCopyFeedback(feedback);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopyFeedback(null), COPY_FEEDBACK_MS);
  };

  const statusOptions: { value: StatusFilter; label: string }[] = [
    { value: "all", label: `All ${summary.total}` },
    { value: "up", label: `Up ${summary.up}` },
    { value: "down", label: `Down ${summary.down}` },
    { value: "unknown", label: `Unknown ${summary.unknown}` }
  ];

  return (
    <section aria-labelledby="services-heading" className="flex flex-col gap-4">
      <h2 id="services-heading" className="sr-only">
        Services
      </h2>

      <div className="flex flex-col gap-3 rounded-xl border border-line/70 bg-surface/60 p-3 lg:flex-row lg:items-center">
        <label className="relative flex-1">
          <span className="sr-only">Search services</span>
          <FiSearch
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name, host, namespace or category"
            className="focus-ring w-full rounded-lg border border-line/70 bg-base/60 py-2 pl-9 pr-3 text-sm! placeholder:text-muted/70"
          />
        </label>
        <fieldset className="flex flex-wrap gap-1">
          <legend className="sr-only">Filter by status</legend>
          {statusOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={status === option.value}
              onClick={() => setStatus(option.value)}
              className={`focus-ring rounded-lg border px-3 py-1.5 text-xs! font-medium tabular-nums transition ${
                status === option.value
                  ? "border-accent/60 bg-accent/15 text-accent"
                  : "border-line/70 text-muted hover:border-accent/40 hover:text-text"
              }`}
            >
              {option.label}
            </button>
          ))}
        </fieldset>
        <div className="flex items-center justify-between gap-3 lg:justify-end">
          <p className="text-xs text-muted" aria-live="polite">
            {(!degraded || degraded.servingLastGood) && (
              <>
                Checked <RelativeTime iso={collectedAt} />
              </>
            )}
          </p>
          <RefreshButton action={refreshAction} />
        </div>
      </div>

      <p
        className={`min-h-4 text-xs ${copyFeedback?.status === "failed" ? "text-rose-500" : "text-emerald-500"}`}
        aria-live="polite"
      >
        {copyFeedback?.message}
      </p>

      {degraded && (
        <StatusBanner tone="error">
          Service discovery is failing ({FAILURE_LABEL[degraded.reason]}) since{" "}
          <RelativeTime iso={degraded.since} />.{" "}
          {degraded.servingLastGood ? (
            <>
              Showing the list from <RelativeTime iso={collectedAt} />; statuses may be out of date.
            </>
          ) : (
            "No earlier list is available."
          )}
        </StatusBanner>
      )}

      {!degraded && apps.length === 0 && (
        <div className="rounded-xl border border-dashed border-line/80 p-6 text-sm text-muted">
          No services are advertising themselves to the portal. An Ingress needs the label{" "}
          <code className="font-[var(--font-mono)] text-xs">app.deedlit.dev/expose=true</code> to
          appear here — see “How this page works” below.
        </div>
      )}

      {apps.length > 0 && shown === 0 && (
        <div className="rounded-xl border border-dashed border-line/80 p-6 text-sm text-muted">
          Nothing matches the current filter.{" "}
          <button
            type="button"
            className="focus-ring rounded text-sm! text-accent underline-offset-2 hover:underline"
            onClick={() => {
              setQuery("");
              setStatus("all");
            }}
          >
            Clear filters
          </button>
        </div>
      )}

      {groups.map((group) => (
        <section key={group.category} aria-labelledby={`group-${group.category}`}>
          <h3
            id={`group-${group.category}`}
            className="mb-3 flex items-baseline gap-2 text-sm font-semibold uppercase tracking-widest text-muted"
          >
            {group.label}
            <span className="font-normal tabular-nums text-muted/60">{group.apps.length}</span>
          </h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {group.apps.map((app) => (
              <ServiceCard
                key={app.id}
                app={app}
                health={health[app.id]}
                onCopy={copyValue}
                copyFeedback={copyFeedback}
              />
            ))}
          </div>
        </section>
      ))}
    </section>
  );
}
