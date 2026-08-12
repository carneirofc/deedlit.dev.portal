import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

export const metadata: Metadata = {
  title: "Portal",
  robots: { index: false, follow: false }
};

/**
 * The security boundary for everything under `/portal`.
 *
 * `src/proxy.ts` also redirects anonymous traffic here, but that is an
 * optimistic UX shortcut — this server-side session check is what actually
 * decides, and it runs on every render regardless of how the request arrived.
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect("/login?callbackUrl=/portal");

  return <>{children}</>;
}
