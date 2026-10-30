"use client";

import { useFormStatus } from "react-dom";

interface PendingSubmitButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type" | "disabled"> {
  /** Rendered instead of `children` while the enclosing form's action runs. */
  pendingChildren?: React.ReactNode;
}

/**
 * A submit button for a server-action form that shows the action is running
 * and refuses a second click until it settles. Sign-in and sign-out end in a
 * redirect that can take a moment, and a repeat sign-in click costs a slot
 * in the per-client sign-in rate limit.
 *
 * Usable from Server Components: only the button is client-side, the form
 * and its action stay where they are.
 */
export function PendingSubmitButton({
  children,
  pendingChildren,
  className = "",
  ...props
}: PendingSubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      {...props}
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`${className} disabled:cursor-progress disabled:opacity-70`}
    >
      {pending ? (pendingChildren ?? children) : children}
    </button>
  );
}
