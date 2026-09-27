"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FiLink, FiExternalLink } from "react-icons/fi";
import {
  CopyIcon,
  OutlineButton,
  SectionLabel,
  StatusBadge,
  StatusBanner,
  SurfacePanel,
  TextInput
} from "@carneirofc/ui";
import { RefreshButton } from "@/features/services/components/RefreshButton";
import { ServiceGlyph } from "@/features/services/components/ServiceGlyph";
import type {
  DiscoveryFailure,
  LocalServiceApp,
  RefreshState,
  ServiceHealth,
  ServiceHealthMap
} from "@/features/services/types";

interface ServicesSectionProps {
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

const COPY_MESSAGE_MS = 2_000;
const RELATIVE_TICK_MS = 10_000;

function relativeTime(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}

/** Re-renders every `RELATIVE_TICK_MS` so "checked 10s ago" keeps counting. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), RELATIVE_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  return now;
}

/**
 * The server and the browser render this a few seconds apart, so the text is
 * allowed to differ at hydration; the absolute time is in `dateTime`/`title`.
 */
function RelativeTime({ iso, now }: { iso: string; now: number }) {
  return (
    <time dateTime={iso} title={new Date(iso).toLocaleString()} suppressHydrationWarning>
      {relativeTime(iso, now)}
    </time>
  );
}

const STATUS_LABEL: Record<ServiceHealth["state"], string> = {
  up: "up",
  down: "down",
  unknown: "unknown"
};

const STATUS_TONE: Record<ServiceHealth["state"], "success" | "error" | "neutral"> = {
  up: "success",
  down: "error",
  unknown: "neutral"
};

const STATUS_BAR: Record<ServiceHealth["state"], string> = {
  up: "bg-emerald-500/40",
  down: "bg-rose-500/40",
  unknown: "bg-slate-500/30"
};

/**
 * Renders the service portal.
 *
 * Discovery and health probing both happen on the server and arrive as props,
 * so the first paint already carries real statuses — there is no loading pass
 * and no client-side probing (which CORS made impossible anyway). This stays a
 * client component for the search box, the clipboard buttons, the refresh
 * feedback and the "checked N s ago" counter — staleness is always shown.
 */
export function ServicesSection({
  apps,
  health,
  collectedAt,
  degraded,
  refreshAction
}: ServicesSectionProps) {
  const [query, setQuery] = useState("");
  const [copyState, setCopyState] = useState("");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const now = useNow();

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const filteredApps = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return apps;

    return apps.filter((app) =>
      `${app.name} ${app.host} ${app.category} ${app.description}`.toLowerCase().includes(needle)
    );
  }, [apps, query]);

  const upCount = apps.filter((app) => health[app.id]?.state === "up").length;

  // The copy buttons are siblings of the card's link, not inside it, so a
  // click here can never also open the service.
  const copyValue = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyState(`Copied: ${value}`);
    } catch {
      setCopyState("Copy unavailable");
    }
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopyState(""), COPY_MESSAGE_MS);
  };

  return (
    <section id="services" className="section-anchor px-4 pb-16 pt-10 sm:px-6 lg:px-8">
      <div className="mb-5">
        <SectionLabel>Services Hub</SectionLabel>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Quick Access</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          Services deployed on the cluster, discovered from their Ingress definitions. Health is
          checked in-cluster against each backing service.
        </p>
      </div>

      <SurfacePanel tone="soft" padding="lg" className="mb-5">
        <label htmlFor="service-search" className="mb-1 block text-xs text-muted">
          Search
        </label>
        <TextInput
          id="service-search"
          type="search"
          controlSize="sm"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="name, host, category"
          className="w-full"
        />
      </SurfacePanel>

      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs text-muted" aria-live="polite">
          {filteredApps.length}/{apps.length} services · {upCount} up
          {(!degraded || degraded.servingLastGood) && (
            <>
              {" "}
              · checked <RelativeTime iso={collectedAt} now={now} />
            </>
          )}
        </p>
        <div className="flex items-center gap-3">
          {copyState && (
            <p className="text-xs text-emerald-400" aria-live="polite">
              {copyState}
            </p>
          )}
          <RefreshButton action={refreshAction} />
        </div>
      </div>

      {degraded && (
        <div className="mb-4">
          <StatusBanner tone="error">
            Service discovery is failing ({FAILURE_LABEL[degraded.reason]}) since{" "}
            <RelativeTime iso={degraded.since} now={now} />.{" "}
            {degraded.servingLastGood ? (
              <>
                Showing the list from <RelativeTime iso={collectedAt} now={now} />; statuses may
                be out of date.
              </>
            ) : (
              "No earlier list is available."
            )}
          </StatusBanner>
        </div>
      )}

      {!degraded && apps.length === 0 && (
        <SurfacePanel tone="subtle" padding="lg">
          <p className="text-sm text-muted">
            No services are advertising themselves to the portal. An Ingress needs the label{" "}
            <code className="font-[var(--font-mono)] text-xs">app.deedlit.dev/expose=true</code> to
            appear here.
          </p>
        </SurfacePanel>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {filteredApps.map((app) => {
          const state = health[app.id]?.state ?? "unknown";
          const responseTime = health[app.id]?.responseTime;
          const detail = health[app.id]?.detail;
          const isUp = state === "up";

          // The card is not a link: `<a>` may not contain buttons. The title
          // carries the link and stretches its hit area over the whole card
          // (`after:absolute after:inset-0`); the copy buttons sit above that
          // overlay, so each control is reached, announced and clicked alone.
          return (
            <article
              key={app.id}
              className={`group relative overflow-hidden rounded-xl2 border shadow-soft transition-all duration-200 focus-within:border-accent/50 ${
                state === "down"
                  ? "border-line/40 bg-surface/30 opacity-60"
                  : "border-line/80 bg-surface/75 hover:border-accent/50 hover:bg-surface hover:shadow-md"
              }`}
            >
              <div className={`h-1 ${STATUS_BAR[state]}`} />

              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      className={`mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border transition-colors ${
                        isUp
                          ? "border-line/80 bg-base/70 text-muted group-hover:border-accent/50 group-hover:bg-accent/10 group-hover:text-accent"
                          : "border-line/40 bg-base/40 text-muted/50"
                      }`}
                    >
                      <ServiceGlyph icon={app.icon} />
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-lg font-semibold tracking-tight transition-colors group-hover:text-accent">
                        <a
                          href={app.url}
                          target="_blank"
                          rel="noreferrer"
                          className="focus-ring rounded-sm after:absolute after:inset-0 after:content-['']"
                        >
                          {app.name}
                        </a>
                      </h3>
                      <p className="mt-1 line-clamp-2 text-xs text-muted">{app.description}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <StatusBadge tone={STATUS_TONE[state]}>{STATUS_LABEL[state]}</StatusBadge>
                    {responseTime !== undefined && state !== "unknown" && (
                      <span className="text-[9px] text-muted/60">{responseTime}ms</span>
                    )}
                    {detail && (
                      <span className="max-w-[10rem] truncate text-[9px] text-muted/60" title={detail}>
                        {detail}
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between gap-2">
                  <p className="truncate font-[var(--font-mono)] text-[11px] text-muted/80">
                    {app.host}
                    {app.namespace && (
                      <span className="text-muted/50" title="Kubernetes namespace of the Ingress">
                        {" "}
                        · {app.namespace}
                      </span>
                    )}
                  </p>
                  <div className="relative z-10 flex shrink-0 gap-1.5">
                    <OutlineButton
                      type="button"
                      controlSize="icon"
                      onClick={() => copyValue(app.host)}
                      title="Copy hostname"
                      aria-label={`Copy hostname of ${app.name}`}
                    >
                      <CopyIcon size="h-3.5 w-3.5" />
                    </OutlineButton>
                    <OutlineButton
                      type="button"
                      controlSize="icon"
                      onClick={() => copyValue(app.url)}
                      title="Copy URL"
                      aria-label={`Copy URL of ${app.name}`}
                    >
                      <FiLink className="h-3.5 w-3.5" />
                    </OutlineButton>
                  </div>
                </div>

                {isUp && (
                  <div
                    className="mt-3 flex items-center gap-1.5 text-xs text-accent opacity-0 transition-opacity group-hover:opacity-100"
                    aria-hidden
                  >
                    <span>Open service</span>
                    <FiExternalLink className="h-3 w-3" />
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
