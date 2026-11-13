"use client";

import { FiCheck, FiX } from "react-icons/fi";
import type { CopyStatus } from "@/features/services/lib/copy-feedback";

const SIZE = {
  sm: { button: "h-6 w-6", icon: "h-3 w-3" },
  md: { button: "h-7 w-7", icon: "h-3.5 w-3.5" }
} as const;

const TONE: Record<CopyStatus | "idle", string> = {
  idle: "border-line/70 text-muted hover:border-accent/50 hover:bg-accent/10 hover:text-accent",
  copied: "border-emerald-500/60 bg-emerald-500/10 text-emerald-500",
  failed: "border-rose-500/60 bg-rose-500/10 text-rose-500"
};

const BUBBLE: Record<CopyStatus, { text: string; tone: string }> = {
  copied: { text: "Copied", tone: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400" },
  failed: { text: "Clipboard unavailable", tone: "border-rose-500/40 text-rose-600 dark:text-rose-400" }
};

interface CopyValueButtonProps {
  value: string;
  /** What the value is ("hostname", "URL", …) — also names the button. */
  what: string;
  serviceName: string;
  /** The idle icon; a check or a cross replaces it while `status` is set. */
  icon: React.ComponentType<{ className?: string }>;
  size: keyof typeof SIZE;
  /** This button's last result, from `copyStatusFor`; null when idle. */
  status: CopyStatus | null;
  onCopy: (value: string, what: string) => void;
}

/**
 * An icon button that copies one value and shows the result on itself: the
 * icon turns into a check (or a cross) and a small label appears above it
 * until the board clears the feedback. The label is `aria-hidden` — the
 * board's `aria-live` region already announces the same result.
 */
export function CopyValueButton({
  value,
  what,
  serviceName,
  icon: Icon,
  size,
  status,
  onCopy
}: CopyValueButtonProps) {
  const ResultIcon = status === "copied" ? FiCheck : status === "failed" ? FiX : Icon;

  return (
    <button
      type="button"
      onClick={() => onCopy(value, what)}
      title={status ? BUBBLE[status].text : `Copy ${what}`}
      aria-label={`Copy ${what} of ${serviceName}`}
      className={`focus-ring relative grid shrink-0 place-items-center rounded-md border motion-safe:active:scale-90 ${SIZE[size].button} ${TONE[status ?? "idle"]}`}
    >
      <ResultIcon
        key={status ?? "idle"}
        className={`${SIZE[size].icon} transition-transform duration-200 motion-safe:starting:scale-50`}
        aria-hidden
      />
      {status && (
        <span
          aria-hidden
          className={`pointer-events-none absolute right-0 bottom-full mb-1.5 whitespace-nowrap rounded-md border bg-surface px-1.5 py-0.5 text-[10px] font-medium shadow-soft transition-[opacity,translate] duration-150 starting:opacity-0 motion-safe:starting:translate-y-1 ${BUBBLE[status].tone}`}
        >
          {BUBBLE[status].text}
        </span>
      )}
    </button>
  );
}
