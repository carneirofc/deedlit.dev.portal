"use client";

import { useEffect, useState } from "react";

const TICK_MS = 10_000;

export function relativeTime(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}

/** Re-renders every `TICK_MS` so "checked 10s ago" keeps counting. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  return now;
}

/**
 * The server and the browser render this a few seconds apart, so the text is
 * allowed to differ at hydration; the absolute time is in `dateTime`/`title`.
 */
export function RelativeTime({ iso, now }: { iso: string; now?: number }) {
  const ticking = useNow();
  return (
    <time dateTime={iso} title={new Date(iso).toLocaleString()} suppressHydrationWarning>
      {relativeTime(iso, now ?? ticking)}
    </time>
  );
}
