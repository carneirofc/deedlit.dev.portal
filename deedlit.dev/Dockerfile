# Build context is the MONOREPO ROOT, not this directory:
#   docker build -f deedlit.dev/Dockerfile -t portal .
#
# The app depends on the sibling workspace `deedlit.dev.ui` (`file:../`), so a
# context scoped to deedlit.dev/ cannot resolve its own dependencies. Nothing
# else from the monorepo enters the image: the install is scoped to these two
# workspaces and the runtime stage copies only Next's standalone output.
#
# Both bases are pinned by digest. A floating tag is a supply-chain hole — it
# lets whoever can write to the registry (or anyone who can intercept an
# unauthenticated pull) swap the image under a name that already passed review.
# Refresh with:
#   docker pull node:24-slim && docker inspect --format '{{index .RepoDigests 0}}' node:24-slim

# ---- Stage 1: dependencies -------------------------------------------------
FROM node:24-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03 AS deps
WORKDIR /app

# Only the manifests, so this layer caches until a dependency actually changes.
# comfyhelper's manifest is copied but never installed: `npm ci` validates the
# lockfile against every workspace it declares and fails if one is missing.
COPY package.json package-lock.json ./
COPY deedlit.dev/package.json deedlit.dev/
COPY deedlit.dev.ui/package.json deedlit.dev.ui/
COPY deedlit.dev.comfyhelper/package.json deedlit.dev.comfyhelper/

# Scoped to the two workspaces this image actually runs. Without the filter npm
# also installs comfyhelper's tree (Prisma, the AWS SDK, @qdrant/js-client-rest
# and its vulnerable undici) — none of which this app imports.
#
# `--ignore-scripts` keeps install-time scripts out of the build. The lockfile
# carries every platform's optional native binaries, so npm picks the Linux
# ones here without any extra step.
RUN npm ci --ignore-scripts --no-audit --no-fund \
      --include-workspace-root \
      --workspace deedlit.dev \
      --workspace @carneirofc/ui

# ---- Stage 2: build --------------------------------------------------------
FROM node:24-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03 AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY deedlit.dev.ui/ ./deedlit.dev.ui/
COPY deedlit.dev/ ./deedlit.dev/

# Builds @carneirofc/ui first (the app's own `build` script chains it), then
# `next build` with output: 'standalone'.
RUN npm run build --workspace deedlit.dev

# Next's dependency tracer pulls `typescript` into the standalone bundle because
# next-server references it on a dev-only code path. 19 MB of compiler that a
# production server never loads — drop it, and hand the tree to the numeric UID
# the chart runs as (podSecurityContext.runAsUser: 1001) so the runtime stage
# needs no user database of its own.
RUN rm -rf deedlit.dev/.next/standalone/node_modules/typescript \
 && chown -R 1001:1001 deedlit.dev/.next/standalone

# ---- Stage 3: runtime ------------------------------------------------------
# Distroless: no shell, no package manager, no perl. The Debian-slim base
# shipped npm and yarn purely as dead weight, and they were the source of every
# CRITICAL/HIGH finding in the image that wasn't the app itself (node-tar,
# undici, brace-expansion, ip-address). A server that only runs
# `node server.js` needs none of it, and the absent shell removes the usual
# post-exploitation foothold.
FROM gcr.io/distroless/nodejs24-debian12@sha256:14d42e2511532589a7c7e01a753667a74fcc96266e137e8125006b87b0c32d0a AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3001 \
    HOSTNAME=0.0.0.0

# For a workspace build, `standalone/` holds the pruned node_modules alongside
# a `deedlit.dev/` directory containing server.js. The app's `postbuild` step
# (scripts/copy-next-static.js) has already placed .next/static and public/
# inside it, so this single copy is the whole runtime.
COPY --from=builder /app/deedlit.dev/.next/standalone ./

# Numeric on purpose: it matches the chart's runAsUser/runAsGroup and satisfies
# runAsNonRoot, which cannot resolve a name.
USER 1001:1001

EXPOSE 3001

# The distroless entrypoint is already /nodejs/bin/node.
CMD ["deedlit.dev/server.js"]
