"use client";

import { FiExternalLink } from "react-icons/fi";
import { CopyIcon } from "@carneirofc/ui";
import type { ServiceLink } from "@/features/services/types";

interface ServiceLinksProps {
  serviceName: string;
  links: ServiceLink[] | undefined;
  /** Copies a value and reports it; the card owns the "Copied" message. */
  onCopy: (value: string, what: string) => void;
}

/**
 * The extra addresses a card advertises (`portal.deedlit.dev/links`), each
 * with its own open and copy controls.
 *
 * Cards stretch their title link over the whole surface, so this list sits on
 * `relative z-10` to stay clickable above that overlay — drop it into any card
 * that follows the same pattern. Renders nothing when there are no links.
 */
export function ServiceLinks({ serviceName, links, onCopy }: ServiceLinksProps) {
  if (!links?.length) return null;

  return (
    <ul
      className="relative z-10 mt-3 space-y-1 border-t border-line/40 pt-2"
      aria-label={`Other addresses for ${serviceName}`}
    >
      {links.map((link) => (
        <li key={`${link.label}|${link.url}`} className="flex items-center justify-between gap-2">
          <a
            href={link.url}
            target="_blank"
            rel="noreferrer"
            title={link.url}
            className="focus-ring inline-flex min-w-0 items-center gap-1 rounded-sm text-xs text-muted hover:text-accent"
          >
            <span className="truncate">{link.label}</span>
            <FiExternalLink className="h-3 w-3 shrink-0" aria-hidden />
          </a>
          <button
            type="button"
            onClick={() => onCopy(link.url, `${link.label} URL`)}
            title={`Copy ${link.label} URL`}
            aria-label={`Copy ${link.label} URL of ${serviceName}`}
            className="focus-ring grid h-6 w-6 shrink-0 place-items-center rounded-md border border-line/70 text-muted transition hover:border-accent/50 hover:text-accent"
          >
            <CopyIcon size="h-3 w-3" />
          </button>
        </li>
      ))}
    </ul>
  );
}
