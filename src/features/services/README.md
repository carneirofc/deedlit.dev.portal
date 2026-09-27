# Services Feature

Powers `/portal`, the authenticated dashboard listing the cluster's services
and their health. Everything here is server-side; the only client code is the
search box, the copy-to-clipboard buttons, the refresh button and the
"checked N s ago" freshness label.

## Structure

| Path                          | Role                                                     |
| ----------------------------- | -------------------------------------------------------- |
| `server/discover.ts`          | Lists services from the Kubernetes API                    |
| `server/health.ts`            | Probes each service in-cluster                            |
| `server/snapshot.ts`          | Shared 15s snapshot; bounds the probe fan-out             |
| `components/ServicesSection.tsx` | Renders the grid, freshness and the degraded banner   |
| `components/RefreshButton.tsx` | Refresh with pending state and rate-limit feedback       |
| `components/ServiceGlyph.tsx` | Icon lookup, with a `generic` fallback                    |
| `data/local-services.ts`      | Development fallback when there is no cluster             |
| `types.ts`                    | Shared types and the annotation contract                  |

## Where the list comes from

Nothing is hard-coded. `discoverServices()` lists Ingress objects labelled
`app.deedlit.dev/expose=true` through the Kubernetes API, authenticating with
the pod's projected ServiceAccount token and pinning the cluster CA. Display
metadata comes from `portal.deedlit.dev/*` annotations on each Ingress, so
adding a service is a values change in `deedlit.dev.infra`, never a change
here. The contract is defined in `types.ts` (`PORTAL_ANNOTATIONS`) and
documented in that repo's `apps/README.md`.

Outside the cluster there is no token, so `data/local-services.ts` is used
instead and the feature stays developable on a laptop.

## What the portal is allowed to read

Two verbs, both read-only, and nothing else:

| Call                                                      | Verb                | Why                            |
| --------------------------------------------------------- | ------------------- | ------------------------------ |
| `GET /apis/networking.k8s.io/v1/ingresses?labelSelector=…` | `list` on ingresses | the exposed service list       |
| `GET /api/v1/namespaces/{ns}/services/{name}`              | `get` on services   | resolve a *named* backend port |

The Service reads are by name, only for backends an exposed Ingress already
points at, and only when the backend port is a name rather than a number. That
is a deliberate choice over the one-line `GET /api/v1/services`: listing needs
`list` on Services cluster-wide, which hands anyone who reaches this token an
inventory of every workload, port and Service annotation in the cluster. `get`
on a name the operator already published discloses nothing new. Annotate
`portal.deedlit.dev/health-port` and even that read disappears.

The matching RBAC in `deedlit.dev.infra` should stay exactly this narrow — no
`watch`, no Pods, Secrets, ConfigMaps or Endpoints, no write verbs:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: portal-discovery
rules:
  - apiGroups: ["networking.k8s.io"]
    resources: ["ingresses"]
    verbs: ["list"]
  - apiGroups: [""]
    resources: ["services"]
    verbs: ["get"]
```

The pod's projected ServiceAccount token is the only credential involved; it is
read from disk per call, so rotation is picked up without a restart, and it is
never forwarded anywhere — the health probes go out unauthenticated.

## How health is checked

`checkServices()` probes `http://<service>.<namespace>.svc.cluster.local:<port><path>`
— the Ingress's **backing Service**, not the public hostname.

This matters. The previous implementation ran `fetch(url, {mode: "cors"})` from
the browser, which could never work: none of these services send CORS headers,
so every check failed and every card rendered "unreachable" no matter what was
actually running. Probing server-to-server removes CORS from the picture
entirely, and probing in-cluster means the result reflects the service rather
than the Cloudflare tunnel, DNS and certificate in front of it.

Anything answering below HTTP 500 counts as up — a registry replying `401` is
serving, which is the question being asked. Probes run concurrently with a 3s
timeout, so one dead service costs one timeout rather than N. Only the status
line is used; the response body is cancelled, never buffered.

Discovery and probing sit behind `server/snapshot.ts`, a 15-second per-process
snapshot with in-flight coalescing. Rendering `/portal` costs one apiserver
list plus one probe per service, so without it a signed-in user holding F5
would turn one session into continuous traffic against every service in the
cluster. Authentication is no defence there — the portal's entire audience is
authenticated. The refresh button calls `invalidatePortalSnapshot()` first, so
an explicit refresh is still a real one — unless it is over its limit, in which
case the page re-renders from cache and says so.

## When discovery fails

Coalescing means every reader waits on the same collection, so it has to end.
Each apiserver call has a hard 6s deadline (the socket-idle timeout alone is
not one — a peer trickling bytes would never trip it) and settles on every
response-stream failure (`error`, `aborted`, a `close` before `end`). The whole
collection is raced against a 16s ceiling on top of that.

A failure is never shown as "no services". `discoverServices()` returns
`{ ok: false, reason }` with `reason` one of `unauthenticated` (401), `rbac`
(403), `unreachable` (thrown, timed out, any other status) or
`invalid-response` (unparseable body). The snapshot then serves the last good
list with `degraded` set — the page shows a banner with the reason and how old
the list is — and caches the failure for 5s so a broken apiserver is not
hammered. With no earlier list, `/api/portal/services` returns **503**; with
one, it returns 200 plus `degraded`. Only the enum leaves the server.

An RBAC regression therefore reads as "permission denied", not as a missing
label. Fix the ClusterRole back to the two verbs listed above — never widen it.

## Adding a service

Do it in `deedlit.dev.infra`, in the owning chart's `values.yaml`:

```yaml
ingress:
  portal:
    expose: true
  annotations:
    portal.deedlit.dev/name: Container Registry
    portal.deedlit.dev/category: ops
    portal.deedlit.dev/icon: registry
    portal.deedlit.dev/health-path: /v2/
```

To add a new **icon**, extend `ServiceIcon` and `SERVICE_ICONS` in `types.ts`
and add the glyph to `ServiceGlyph.tsx`. Unknown values fall back to `generic`
rather than rendering an empty card.

## Who can publish a card

Discovery lists labelled Ingresses **cluster-wide**, and every field on a card
comes from the Ingress. So the assumption, stated explicitly: *every principal
able to create a labelled Ingress on an allowed host is trusted to publish to
the portal.* Three things narrow what that principal can do:

- Only hosts under `PORTAL_ALLOWED_HOST_SUFFIXES` (default `deedlit.dev`,
  matched on a label boundary, wildcards refused) become cards, so a card
  cannot point off-domain.
- Two Ingresses claiming one host produce one card (the first listed); the
  collision is logged with both namespaces.
- Each card shows its namespace, so one that does not belong is visible.

If anyone other than the operator can create Ingresses (CI tokens, shared
namespaces, operators generating Ingresses), restrict discovery to a namespace
allow-list with per-namespace `Role`s — tracked in
`docs/plans/portal-review/06-ingress-trust-boundary.md`.

## Security notes

Annotations are operator-supplied input, so the probe target is never built
from a raw annotation. Namespace and service names are validated as DNS labels,
the port is range-checked, the path must be a simple absolute path, and
`health.ts` re-verifies the final URL before any request goes out: plain HTTP,
no credentials in the URL, and a host matching `<service>.<namespace>
.svc.cluster.local` exactly. The exact match matters — a suffix test would also
admit `evil.attacker-controlled.example.svc.cluster.local`, a name whose owner
decides where it resolves. Redirects are not followed. Together that is what
stops a hostile annotation from turning the portal into an SSRF proxy.

Apiserver responses are capped at 2 MiB and named-port lookups at 32 per
refresh, so neither a surprising response nor an unexpectedly large exposed set
can be turned into memory pressure on the pod.

`/api/portal/services` is limited to 30 requests a minute and the refresh
action to 10, both keyed on the session identity rather than on a header — see
`src/lib/rate-limit.ts`. Over the limit the API returns 429 with `Retry-After`;
refresh degrades to a cache-backed re-render rather than an error.

## Transport

The apiserver call carries the ServiceAccount token, so it verifies against the
cluster CA from the projected volume (not the system trust store), floors at
TLS 1.2, and has no configuration switch that disables any of it — the escape
hatch is what gets used at 3am.

The health probes are plain HTTP on purpose. They carry no credential, send no
cookie, do not follow redirects and read only the status line, so an on-path
attacker inside the cluster gains nothing but the ability to lie about whether
a service is up. If that becomes part of the threat model, the answer is a
service mesh or a NetworkPolicy restricting this pod's egress — not TLS bolted
onto the prober, which would need a trust anchor per service.
