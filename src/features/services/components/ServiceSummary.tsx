import { FiActivity, FiAlertTriangle, FiCheckCircle, FiHelpCircle, FiLayers } from "react-icons/fi";
import type { ServiceSummary as Summary } from "@/features/services/lib/summary";

interface TileProps {
  label: string;
  value: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
}

function Tile({ label, value, hint, icon: Icon, tone }: TileProps) {
  return (
    <div className="rounded-xl border border-line/70 bg-surface/70 p-4 shadow-soft">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-widest text-muted">{label}</span>
        <Icon className={`h-4 w-4 ${tone}`} aria-hidden />
      </div>
      <p className={`mt-2 text-3xl font-semibold tabular-nums tracking-tight ${tone}`}>{value}</p>
      <p className="mt-1 text-xs text-muted">{hint}</p>
    </div>
  );
}

/** The at-a-glance row above the service grid. */
export function ServiceSummary({ summary }: { summary: Summary }) {
  const { total, up, down, unknown, medianResponseMs } = summary;

  return (
    <section aria-label="Summary" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      <Tile
        label="Services"
        value={String(total)}
        hint="discovered from Ingresses"
        icon={FiLayers}
        tone="text-text"
      />
      <Tile
        label="Up"
        value={String(up)}
        hint={total ? `${Math.round((up / total) * 100)}% answering` : "nothing to probe"}
        icon={FiCheckCircle}
        tone="text-emerald-500"
      />
      <Tile
        label="Down"
        value={String(down)}
        hint={down ? "5xx, timeout or refused" : "no failures"}
        icon={FiAlertTriangle}
        tone={down ? "text-rose-500" : "text-muted"}
      />
      <Tile
        label="Unknown"
        value={String(unknown)}
        hint="no in-cluster backend to probe"
        icon={FiHelpCircle}
        tone="text-muted"
      />
      <Tile
        label="Median latency"
        value={medianResponseMs === null ? "—" : `${medianResponseMs} ms`}
        hint="in-cluster probe round-trip"
        icon={FiActivity}
        tone="text-accent"
      />
    </section>
  );
}
