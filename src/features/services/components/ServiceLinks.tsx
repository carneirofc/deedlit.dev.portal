"use client";

import { FiExternalLink } from "react-icons/fi";
import { CopyIcon } from "@carneirofc/ui";
import { CopyValueButton } from "@/features/services/components/CopyValueButton";
import { type CopyFeedback, copyStatusFor } from "@/features/services/lib/copy-feedback";
import type { ServiceLink } from "@/features/services/types";

interface ServiceLinksProps {
  serviceName: string;
  links: ServiceLink[] | undefined;
  /** Copies a value and reports it; the board owns the feedback. */
  onCopy: (value: string, what: string) => void;
  /** The board's latest copy result; each button shows it only if it is its own. */
  copyFeedback: CopyFeedback | null;
}

/**
 * The extra addresses a card advertises (`portal.deedlit.dev/links`), each
 * with its own open and copy controls.
 *
 * Cards stretch their title link over the whole surface, so this list sits on
 * `relative z-10` to stay clickable above that overlay — drop it into any card
 * that follows the same pattern. Renders nothing when there are no links.
 */
export function ServiceLinks({ serviceName, links, onCopy, copyFeedback }: ServiceLinksProps) {
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
          <CopyValueButton
            value={link.url}
            what={`${link.label} URL`}
            serviceName={serviceName}
            icon={CopyIcon}
            size="sm"
            status={copyStatusFor(copyFeedback, link.url, `${link.label} URL`)}
            onCopy={onCopy}
          />
        </li>
      ))}
    </ul>
  );
}
