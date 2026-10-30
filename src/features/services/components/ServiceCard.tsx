"use client";

import { FiExternalLink, FiLink } from "react-icons/fi";
import { CopyIcon } from "@carneirofc/ui";
import { RelativeTime } from "@/components/RelativeTime";
import { CopyValueButton } from "@/features/services/components/CopyValueButton";
import { ServiceGlyph } from "@/features/services/components/ServiceGlyph";
import { ServiceLinks } from "@/features/services/components/ServiceLinks";
import { StatusPill } from "@/features/services/components/StatusPill";
import { type CopyFeedback, copyStatusFor } from "@/features/services/lib/copy-feedback";
import type { HealthState, LocalServiceApp, ServiceHealth } from "@/features/services/types";

const STATUS_BAR: Record<HealthState, string> = {
  up: "bg-emerald-500/60",
  down: "bg-rose-500/70",
  unknown: "bg-slate-500/30"
};

interface ServiceCardProps {
  app: LocalServiceApp;
  health: ServiceHealth | undefined;
  onCopy: (value: string, what: string) => void;
  /** The board's latest copy result; each button shows it only if it is its own. */
  copyFeedback: CopyFeedback | null;
}

/**
 * The card is not a link: `<a>` may not contain buttons. The title carries the
 * link and stretches its hit area over the whole card (`after:absolute
 * after:inset-0`); the copy buttons sit above that overlay, so each control is
 * reached, announced and clicked on its own.
 */
export function ServiceCard({ app, health, onCopy, copyFeedback }: ServiceCardProps) {
  const state = health?.state ?? "unknown";
  const isDown = state === "down";

  return (
    <article
      className={`group relative flex flex-col overflow-hidden rounded-xl2 border bg-surface/75 shadow-soft transition-all duration-200 focus-within:border-accent/50 hover:border-accent/50 hover:bg-surface hover:shadow-md motion-safe:hover:-translate-y-0.5 ${
        isDown ? "border-rose-500/40" : "border-line/80"
      }`}
    >
      <div className={`h-1 ${STATUS_BAR[state]}`} />

      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-line/80 bg-base/70 text-muted transition-colors group-hover:border-accent/50 group-hover:bg-accent/10 group-hover:text-accent">
              <ServiceGlyph icon={app.icon} />
            </span>
            <div className="min-w-0">
              <h3 className="text-[1rem] font-semibold tracking-tight text-text transition-colors group-hover:text-accent">
                <a
                  href={app.url}
                  target="_blank"
                  rel="noreferrer"
                  className="focus-ring rounded-sm after:absolute after:inset-0 after:content-['']"
                >
                  {app.name}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </h3>
              <p className="mt-1 line-clamp-2 text-xs text-muted">
                {app.description || "No description annotated."}
              </p>
            </div>
          </div>
          <StatusPill state={state} className="shrink-0" />
        </div>

        {isDown && health?.detail && (
          <p className="mt-3 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-xs text-rose-500">
            {health.detail}
          </p>
        )}

        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
          <dt className="text-muted/70">host</dt>
          <dd className="truncate font-[var(--font-mono)] text-muted" title={app.host}>
            {app.host}
          </dd>
          {app.namespace && (
            <>
              <dt className="text-muted/70">namespace</dt>
              <dd className="truncate font-[var(--font-mono)] text-muted">{app.namespace}</dd>
            </>
          )}
          {health && state !== "unknown" && (
            <>
              <dt className="text-muted/70">probe</dt>
              <dd className="text-muted">
                {health.responseTime !== undefined && `${health.responseTime} ms · `}
                <RelativeTime iso={health.checkedAt} />
              </dd>
            </>
          )}
          {state === "unknown" && health?.detail && (
            <>
              <dt className="text-muted/70">probe</dt>
              <dd className="text-muted">{health.detail}</dd>
            </>
          )}
        </dl>

        <ServiceLinks
          serviceName={app.name}
          links={app.links}
          onCopy={onCopy}
          copyFeedback={copyFeedback}
        />

        <div className="mt-auto flex items-center justify-between gap-2 pt-3">
          <span
            className="flex items-center gap-1.5 text-xs text-accent opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
            aria-hidden
          >
            Open <FiExternalLink className="h-3 w-3" />
          </span>
          <div className="relative z-10 flex shrink-0 gap-1.5">
            <CopyValueButton
              value={app.host}
              what="hostname"
              serviceName={app.name}
              icon={CopyIcon}
              size="md"
              status={copyStatusFor(copyFeedback, app.host, "hostname")}
              onCopy={onCopy}
            />
            <CopyValueButton
              value={app.url}
              what="URL"
              serviceName={app.name}
              icon={FiLink}
              size="md"
              status={copyStatusFor(copyFeedback, app.url, "URL")}
              onCopy={onCopy}
            />
          </div>
        </div>
      </div>
    </article>
  );
}
