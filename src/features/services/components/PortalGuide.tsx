import { FiBookOpen } from "react-icons/fi";

function Item({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-sm font-semibold">{title}</dt>
      <dd className="mt-1 text-sm leading-relaxed text-muted">{children}</dd>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-base/70 px-1 py-0.5 font-[var(--font-mono)] text-[12px] text-text">
      {children}
    </code>
  );
}

/**
 * What the numbers on the dashboard mean and how to act on them. Static,
 * server-rendered, collapsed by default so it stays out of the way.
 */
export function PortalGuide() {
  return (
    <details className="group rounded-xl border border-line/70 bg-surface/60 p-4 open:pb-5">
      <summary className="focus-ring flex cursor-pointer list-none items-center gap-2 rounded text-sm font-semibold">
        <FiBookOpen className="h-4 w-4 text-accent" aria-hidden />
        How this page works
        <span className="ml-auto text-xs font-normal text-muted group-open:hidden">show</span>
        <span className="ml-auto hidden text-xs font-normal text-muted group-open:inline">hide</span>
      </summary>

      <dl className="mt-4 grid gap-5 md:grid-cols-2">
        <Item title="Where the list comes from">
          Every Kubernetes Ingress labelled <Code>app.deedlit.dev/expose=true</Code> becomes a
          card. Name, description, category, icon and order come from its{" "}
          <Code>portal.deedlit.dev/*</Code> annotations, and only hosts under the allowed domain
          suffixes are shown. Adding a service is a values change in{" "}
          <Code>deedlit.dev.infra</Code>, not a change here.
        </Item>
        <Item title="What “up” means">
          Each service is probed from inside the cluster, against its backing Service rather than
          the public hostname, with a 3 s timeout. Any answer below HTTP 500 counts as up — a
          login redirect or a 401 still proves the process is serving. <em>Down</em> is a 5xx, a
          timeout or a refused connection; <em>unknown</em> means there was no in-cluster backend
          to probe.
        </Item>
        <Item title="How fresh it is">
          Results are shared for 15 s across everyone viewing the portal, so reloading does not
          re-probe the cluster. <em>Refresh</em> forces a new round, up to 10 times a minute;
          past that you get the cached result and the page says so.
        </Item>
        <Item title="If a link does not open">
          Most hosts resolve only over the WireGuard tunnel. Bring the tunnel up, and if a name
          still does not resolve, run <Code>make wireguard</Code> in{" "}
          <Code>deedlit.dev.infra/ansible</Code> to refresh the pinned hosts on this machine.
        </Item>
        <Item title="Scripting against it">
          <Code>GET /api/portal/services</Code> returns the same data as JSON for a signed-in
          session (30 requests a minute). It answers 401 without a session and 503 when discovery
          is failing with nothing cached.
        </Item>
        <Item title="When discovery fails">
          The last good list stays on screen under a red banner that names the failure — a
          permissions problem, a rejected token or an unreachable API — instead of an empty page
          that looks like a quiet cluster.
        </Item>
      </dl>
    </details>
  );
}
