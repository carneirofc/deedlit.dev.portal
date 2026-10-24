import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { IBM_Plex_Mono, Sora } from "next/font/google";
import "./globals.css";

const themeInitScript = `
(() => {
  try {
    const match = document.cookie.match(/(?:^|; )deedlit-theme=(dark|light)/);
    const stored = match ? match[1] : null;
    const preferred = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    const resolved = stored || preferred;
    document.documentElement.setAttribute("data-theme", resolved);
    document.documentElement.classList.toggle("dark", resolved === "dark");
  } catch {}
})();
`;

const display = Sora({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "500", "600", "700"]
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500"]
});

export const metadata: Metadata = {
  title: {
    default: "Service Portal | deedlit.dev",
    template: "%s | deedlit.dev portal"
  },
  description: "Private dashboard for the deedlit.dev cluster's services.",
  applicationName: "deedlit.dev portal",
  // Every page is behind a session; nothing here belongs in an index.
  robots: { index: false, follow: false },
  formatDetection: { telephone: false }
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0c13" }
  ]
};

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Stamped by src/proxy.ts. The theme script has to run inline and before
  // paint to avoid a flash, so it takes the nonce rather than the CSP taking
  // 'unsafe-inline'.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: themeInitScript is a
            module-level string literal, never user input. It has to be inline and
            synchronous to set the theme before first paint, and it carries the
            per-request CSP nonce from src/proxy.ts so the strict policy still holds. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body
        className={`${display.variable} ${mono.variable} min-h-screen font-[var(--font-display)] antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
