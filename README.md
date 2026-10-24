# deedlit.dev.portal

Next.js site for deedlit.dev: home, books shelf, image gallery, PWA
assets, and the authenticated `/portal` service dashboard (GitHub OAuth /
generic OIDC). Deployed by `deedlit.dev.infra` at `portal.deedlit.dev`,
reachable over the WireGuard tunnel only.

Split out of the `deedlit.dev` monorepo (`carneirofc/deedlit.dev`) into its
own repo. It consumes the shared component library `@carneirofc/ui` as a
published GitHub Packages dependency — that package's source still lives in
`deedlit.dev.ui` in the monorepo.

## Development

```bash
npm install   # requires a GitHub Packages read token, see below
npm run dev   # http://localhost:3001
```

`@carneirofc/ui` is published under the `@carneirofc` scope on GitHub
Packages, which requires authentication even for public packages. Add a
token with `read:packages` scope to your user-level `~/.npmrc`:

```
//npm.pkg.github.com/:_authToken=<token>
```

Copy `.env.example` to `.env.local` and fill in the auth provider(s) you
want to test against.

## Build & container

```bash
npm run build
DOCKER_BUILDKIT=1 docker build --secret id=npm_token,env=NODE_AUTH_TOKEN -t portal .
```

See `AGENTS.md` for architecture, auth, and deployment details.
