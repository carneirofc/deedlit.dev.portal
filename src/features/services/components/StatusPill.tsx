import type { HealthState } from "@/features/services/types";

const STYLE: Record<HealthState, { pill: string; dot: string; label: string }> = {
  up: {
    pill: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    dot: "bg-emerald-500",
    label: "Up"
  },
  down: {
    pill: "border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400",
    dot: "bg-rose-500",
    label: "Down"
  },
  unknown: {
    pill: "border-line/80 bg-base/40 text-muted",
    dot: "bg-slate-400",
    label: "Unknown"
  }
};

export function StatusPill({ state, className = "" }: { state: HealthState; className?: string }) {
  const style = STYLE[state];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${style.pill} ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} aria-hidden />
      {style.label}
    </span>
  );
}
