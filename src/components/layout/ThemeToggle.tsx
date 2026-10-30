"use client";

import { useEffect, useState } from "react";
import { FiMoon, FiSun } from "react-icons/fi";

type Theme = "light" | "dark";

const THEME_COOKIE = "deedlit-theme";

function currentTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/**
 * The inline script in the root layout resolves the theme before first paint;
 * this only flips it and persists the choice in a cookie the script reads.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => setTheme(currentTheme()), []);

  const toggle = () => {
    const next: Theme = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    document.documentElement.setAttribute("data-theme", next);
    // The pre-paint script in the root layout must read the choice synchronously, hence a cookie.
    // biome-ignore lint/suspicious/noDocumentCookie: read by the inline theme script before paint
    document.cookie = `${THEME_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`;
    setTheme(next);
  };

  const label = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={theme === null}
      aria-label={label}
      title={label}
      className="focus-ring grid h-9 w-9 place-items-center rounded-lg border border-line/70 text-muted transition hover:border-accent/50 hover:bg-accent/10 hover:text-text motion-safe:active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {theme === "dark" ? (
        <FiSun className="h-4 w-4" aria-hidden />
      ) : (
        <FiMoon className="h-4 w-4" aria-hidden />
      )}
    </button>
  );
}
