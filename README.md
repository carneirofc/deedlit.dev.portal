# deedlit.dev.portal

Next.js site for deedlit.dev: home, books shelf, image gallery, PWA
assets, and the authenticated `/portal` service dashboard (GitHub OAuth /
generic OIDC). Deployed by `deedlit.dev.infra` at `portal.deedlit.dev`,
reachable over the WireGuard tunnel only.

Split out of the `deedlit.dev` monorepo into its own repo. The shared
component library `@carneirofc/ui` (source: `deedlit.dev.ui/` in
`carneirofc/deedlit.dev.ui`) is **vendored** as a packed tarball in
`vendor/` and referenced with a `file:` dependency, so installs and image
builds need no GitHub Packages token.

## Development

```bash
npm ci        # no registry token needed
npm run dev   # http://localhost:3001
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

Copy `.env.example` to `.env.local` and fill in the auth provider(s) you
want to test against.

## Build & container

```bash
npm run build
docker build -t portal .
```

See `AGENTS.md` for architecture, auth, and deployment details.
