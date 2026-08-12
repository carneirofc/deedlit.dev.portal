"use client";

import { useMemo, useState } from "react";
import { FiRefreshCw, FiLink, FiExternalLink } from "react-icons/fi";
import {
  CopyIcon,
  OutlineButton,
  SectionLabel,
  StatusBadge,
  SurfacePanel,
  TextInput
} from "@carneirofc/ui";
import { ServiceGlyph } from "@/features/services/components/ServiceGlyph";
import type {
  LocalServiceApp,
  ServiceHealth,
  ServiceHealthMap
} from "@/features/services/types";

interface ServicesSectionProps {
  apps: LocalServiceApp[];
  health: ServiceHealthMap;
  /** Server action: re-probes and revalidates the page. */
  refreshAction: () => Promise<void>;
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
 * client component only for the search box and the clipboard buttons.
 */
export function ServicesSection({ apps, health, refreshAction }: ServicesSectionProps) {
  const [query, setQuery] = useState("");
  const [copyState, setCopyState] = useState("");

  const filteredApps = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return apps;

    return apps.filter((app) =>
      `${app.name} ${app.host} ${app.category} ${app.description}`.toLowerCase().includes(needle)
    );
  }, [apps, query]);

  const upCount = apps.filter((app) => health[app.id]?.state === "up").length;

  const copyValue = async (value: string, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopyState(`Copied: ${value}`);
    } catch {
      setCopyState("Copy unavailable");
    }
    setTimeout(() => setCopyState(""), 2000);
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
        </p>
        <div className="flex items-center gap-3">
          {copyState && (
            <p className="text-xs text-emerald-400" aria-live="polite">
              {copyState}
            </p>
          )}
          <form action={refreshAction}>
            <OutlineButton type="submit" controlSize="xs" title="Re-run the health checks">
              <FiRefreshCw className="h-3.5 w-3.5" />
              Refresh
            </OutlineButton>
          </form>
        </div>
      </div>

      {apps.length === 0 && (
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

          return (
            <a
              key={app.id}
              href={app.url}
              target="_blank"
              rel="noreferrer"
              className={`focus-ring group relative block overflow-hidden rounded-xl2 border shadow-soft transition-all duration-200 ${
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
                        {app.name}
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
                  </p>
                  <div className="flex shrink-0 gap-1.5">
                    <OutlineButton
                      type="button"
                      controlSize="icon"
                      onClick={(event) => copyValue(app.host, event)}
                      title="Copy hostname"
                      aria-label="Copy hostname"
                    >
                      <CopyIcon size="h-3.5 w-3.5" />
                    </OutlineButton>
                    <OutlineButton
                      type="button"
                      controlSize="icon"
                      onClick={(event) => copyValue(app.url, event)}
                      title="Copy URL"
                      aria-label="Copy URL"
                    >
                      <FiLink className="h-3.5 w-3.5" />
                    </OutlineButton>
                  </div>
                </div>

                {isUp && (
                  <div className="mt-3 flex items-center gap-1.5 text-xs text-accent opacity-0 transition-opacity group-hover:opacity-100">
                    <span>Open service</span>
                    <FiExternalLink className="h-3 w-3" />
                  </div>
                )}
              </div>
            </a>
          );
        })}
      </div>
    </section>
  );
}
