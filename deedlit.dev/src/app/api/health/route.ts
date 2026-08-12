import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Liveness/readiness probe for Kubernetes. Unauthenticated by necessity — the
 * kubelet has no session — so it reports nothing beyond "this process is
 * serving": no version, environment, or dependency status.
 */
export function GET() {
  return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
