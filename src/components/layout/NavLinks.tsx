"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FiGrid, FiUser } from "react-icons/fi";

const LINKS = [
  { href: "/", label: "Services", icon: FiGrid },
  { href: "/account", label: "Account", icon: FiUser }
] as const;

export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary" className="flex items-center gap-1">
      {LINKS.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`focus-ring flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition motion-safe:active:scale-[0.97] ${
              active
                ? "bg-accent/15 font-semibold text-accent"
                : "text-muted hover:bg-surface hover:text-text"
            }`}
          >
            <Icon className="h-4 w-4" aria-hidden />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
