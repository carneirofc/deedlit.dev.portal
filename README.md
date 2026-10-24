# deedlit.dev.portal

Private service portal for the deedlit.dev cluster: a signed-in dashboard of
every service the cluster publishes, with live in-cluster health, plus an
account page that shows who you are signed in as and why you were let in.
Sign-in is GitHub OAuth and/or a generic OIDC issuer, both allow-listed.

Deployed by `deedlit.dev.infra` at `portal.deedlit.dev`, reachable over the
WireGuard tunnel only. **Every route requires a session** except `/login`,
`/api/auth/*`, `/api/health` and `/robots.txt` (`src/lib/public-paths.ts`).

| Route                       | What it is                                                     |
| --------------------------- | -------------------------------------------------------------- |
| `/`                         | Services: summary, search, status filter, cards by category    |
| `/account`                  | Identity, provider, account id, which rule granted access      |
| `/login`                    | Sign-in (public)                                               |
| `/api/portal/services`      | The dashboard data as JSON (session required, 30 req/min)      |
| `/api/health`               | Liveness/readiness (public, dependency-free)                   |
| `/portal`                   | 308 → `/` (old bookmarks)                                      |

The services list is not code: an Ingress labelled
`app.deedlit.dev/expose=true` with `portal.deedlit.dev/*` annotations becomes
a card. See `src/features/services/README.md`.

The shared component library `@carneirofc/ui` (source:
`carneirofc/deedlit.dev.ui`) is **vendored** as a packed tarball in `vendor/`
and referenced with a `file:` dependency, so installs and image builds need no
GitHub Packages token.

## Development

```bash
npm ci        # no registry token needed
npm run dev   # http://localhost:3001
```

Copy `.env.example` to `.env.local` and fill in the auth provider(s) you want
to test against. Outside a cluster there is no ServiceAccount token, so the
dashboard falls back to the static list in
`src/features/services/data/local-services.ts` (every card "unknown").

```bash
npm test             # vitest: auth, redirects, public paths, discovery, CSP, …
npm run lint         # biome
npx tsc --noEmit
```

### Updating `@carneirofc/ui`

Build the tarball from a release tag the same way `publish-ui.yml` does, then
swap it in:

```bash
cd ../deedlit.dev.ui
git worktree add --detach /tmp/ui vX.Y.Z && cd /tmp/ui
npm ci --ignore-scripts
npm version X.Y.Z --workspace @carneirofc/ui --no-git-tag-version --allow-same-version
npm run build:ui
npm pack --workspace @carneirofc/ui --pack-destination <portal>/vendor
cd <portal>
git rm vendor/carneirofc-ui-<old>.tgz
# point package.json at file:vendor/carneirofc-ui-X.Y.Z.tgz
npm install   # refreshes the integrity hash in package-lock.json
```

Release tags newer than v1.2.0 use pnpm (`pnpm --filter @carneirofc/ui
build` and `pnpm pack`). The steps are otherwise the same.

## Build & container

```bash
npm run build
docker build -t portal .
```

See `AGENTS.md` for architecture, auth, security and deployment details.
