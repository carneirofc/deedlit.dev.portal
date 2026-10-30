/**
 * The result of one click on a copy button, kept just long enough to show it
 * on that button and announce it.
 *
 * Kept free of React and the DOM so the rules are unit-testable: the board's
 * hook only adds the timer that clears it.
 */

export type CopyStatus = "copied" | "failed";

export interface CopyFeedback {
  /** Which button was clicked — see `copyKey`. */
  key: string;
  status: CopyStatus;
  /** For the board's `aria-live` region. */
  message: string;
}

/** How long a button shows its result before reverting. */
export const COPY_FEEDBACK_MS = 2_000;

/**
 * Identifies a button by what it copies. Two buttons only share a key when
 * they copy the same value under the same name, in which case showing the
 * result on both is right.
 */
export function copyKey(value: string, what: string): string {
  return `${what}\u0000${value}`;
}

/**
 * Writes `value` to the clipboard and describes the outcome. Never throws:
 * `navigator.clipboard` is undefined outside a secure context and
 * `writeText` rejects without permission or focus — both are a failure to
 * report, not an error to surface.
 */
export async function copyToClipboard(
  value: string,
  what: string,
  clipboard: Pick<Clipboard, "writeText"> | undefined
): Promise<CopyFeedback> {
  const key = copyKey(value, what);
  try {
    if (!clipboard) throw new Error("no clipboard");
    await clipboard.writeText(value);
    return { key, status: "copied", message: `Copied ${what}: ${value}` };
  } catch {
    return { key, status: "failed", message: "Clipboard unavailable" };
  }
}

/** The state a given button should show for the current feedback. */
export function copyStatusFor(
  feedback: CopyFeedback | null,
  value: string,
  what: string
): CopyStatus | null {
  return feedback?.key === copyKey(value, what) ? feedback.status : null;
}
