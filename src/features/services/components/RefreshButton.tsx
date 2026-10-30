"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { FiRefreshCw } from "react-icons/fi";
import { OutlineButton } from "@carneirofc/ui";
import type { RefreshState } from "@/features/services/types";

interface RefreshButtonProps {
  /** Server action: re-probes (unless rate-limited) and revalidates the page. */
  action: (previous: RefreshState) => Promise<RefreshState>;
}

const INITIAL: RefreshState = { refreshed: null };

/**
 * Disabled while a re-probe runs: it can take several seconds, and a button
 * that stays clickable invites repeat clicks that burn the refresh budget.
 */
function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <OutlineButton
      type="submit"
      controlSize="xs"
      disabled={pending}
      aria-busy={pending}
      title="Re-run the health checks"
      // Busy, not forbidden: overrides OutlineButton's `disabled:cursor-not-allowed`.
      className="disabled:cursor-progress"
    >
      <FiRefreshCw className={`h-3.5 w-3.5 ${pending ? "animate-spin" : ""}`} aria-hidden />
      {pending ? "Refreshing…" : "Refresh"}
    </OutlineButton>
  );
}

export function RefreshButton({ action }: RefreshButtonProps) {
  const [state, formAction] = useActionState(action, INITIAL);

  return (
    <form action={formAction} className="flex items-center gap-3">
      {state.refreshed === false && (
        <p className="text-xs text-amber-400" role="status">
          Refresh limit reached, showing cached data
        </p>
      )}
      <SubmitButton />
    </form>
  );
}
