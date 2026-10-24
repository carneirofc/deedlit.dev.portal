# Build context is this repo's root:
#   docker build -t portal .
#
# Every stage is Ubuntu 26.04 LTS. No Debian base anywhere: its stable
# packages lag upstream and carry long-lived CVEs. (The distroless
# nodejs24-debian12 runtime used here before never got a fixed libssl3.)
#
# `@carneirofc/ui` is vendored as a packed tarball under vendor/ and referenced
# with a file: dependency, so `npm ci` needs no registry credentials — every
# other dependency comes from the public npm registry. The lockfile pins the
# tarball's integrity hash, so a changed tarball fails the install.
#
# Supply chain: every input is pinned to content, never to a mutable name.
#   - The Ubuntu base by digest. Refresh with:
#       docker pull ubuntu:26.04 && docker inspect --format '{{index .RepoDigests 0}}' ubuntu:26.04
#   - Node by the sha256 of the official linux-x64 tarball. Take it from
#     https://nodejs.org/dist/vX.Y.Z/SHASUMS256.txt after checking that file's
#     signature against https://github.com/nodejs/release-keys:
#       gpgv --keyring ./pubring.kbx SHASUMS256.txt.sig SHASUMS256.txt
#   - chisel by the sha384 its GitHub release publishes, and the slice
#     definitions (canonical/chisel-releases) by commit.
ARG UBUNTU_IMAGE=docker.io/library/ubuntu:26.04@sha256:42527649dbc4f9197a6073f426f488cbff0e9cc9f2afce32d91c383e4875634a

# ---- Stage 0: Ubuntu + the official Node build ------------------------------
# Ubuntu's own nodejs package is not Node 24, and Canonical publishes no
# Node 24 rock, so Node comes from nodejs.org. Its binaries bundle OpenSSL,
# ICU and the CA store, and link only glibc, libstdc++ and libgcc_s.
FROM ${UBUNTU_IMAGE} AS node
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
ARG NODE_VERSION=24.22.1
ARG NODE_SHA256=6c172a9ab6718f7b801fb5a7bd486af2ee5e32758086a04b84fcce2aa77095e6
# Package versions float with the pinned base digest, which is what fixes them.
# hadolint ignore=DL3008
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl xz-utils \
 && rm -rf /var/lib/apt/lists/*
RUN curl -fsSLo /tmp/node.tar.xz "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
 && echo "${NODE_SHA256}  /tmp/node.tar.xz" | sha256sum -c - \
 && mkdir -p /opt/node \
 && tar -xJf /tmp/node.tar.xz -C /opt/node --strip-components=1 --no-same-owner \
 && rm /tmp/node.tar.xz
ENV PATH=/opt/node/bin:${PATH}

# ---- Stage 1: dependencies -------------------------------------------------
FROM node AS deps
WORKDIR /app

# Only the manifest and the vendored tarball, so this layer caches until a
# dependency actually changes.
COPY package.json package-lock.json ./
COPY vendor/ ./vendor/

# `--ignore-scripts` keeps install-time scripts out of the build. The lockfile
# carries every platform's optional native binaries, so npm picks the Linux
# ones here without any extra step.
RUN npm ci --ignore-scripts --no-audit --no-fund

# ---- Stage 2: build --------------------------------------------------------
FROM node AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# `next build` with output: 'standalone'.
RUN npm run build

# Next's dependency tracer pulls `typescript` into the standalone bundle because
# next-server references it on a dev-only code path. 19 MB of compiler that a
# production server never loads — drop it, and hand the tree to the numeric UID
# the chart runs as (podSecurityContext.runAsUser: 1001) so the runtime stage
# needs no user database of its own.
RUN rm -rf .next/standalone/node_modules/typescript \
 && chown -R 1001:1001 .next/standalone

# ---- Stage 3: chiselled Ubuntu root filesystem ------------------------------
# chisel cuts only the files Node needs out of Ubuntu's own .debs. The result
# is a distroless root: no shell, no package manager, no coreutils, and no
# system OpenSSL or CA bundle (Node ships its own; the in-cluster API call
# pins the service-account CA).
#
# Scanners do not read chisel's manifest (Trivy 0.76 sees "ubuntu 26.04" and
# zero packages, so a clean report would mean nothing). Each sliced package
# therefore gets a dpkg status.d entry built from its real control file, the
# way distroless images record theirs. The deb is re-downloaded at the exact
# version chisel recorded, and its sha256 must match the manifest's.
FROM ${UBUNTU_IMAGE} AS rootfs
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
ARG CHISEL_VERSION=v1.5.1
ARG CHISEL_SHA384=89612f46de83e850aae11fca26a32a22cc2964891f2cc538211b906787d2b83e4496fa203a5074e06a9932f1fbe84a73
ARG CHISEL_RELEASES_COMMIT=2946deb112bf896ed35d42ac4f63a50c39c8aa96
# hadolint ignore=DL3008
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl jq zstd
RUN curl -fsSLo /tmp/chisel.tar.gz "https://github.com/canonical/chisel/releases/download/${CHISEL_VERSION}/chisel_${CHISEL_VERSION}_linux_amd64.tar.gz" \
 && echo "${CHISEL_SHA384}  /tmp/chisel.tar.gz" | sha384sum -c - \
 && tar -xzf /tmp/chisel.tar.gz -C /usr/local/bin chisel \
 && mkdir -p /tmp/chisel-releases \
 && curl -fsSL "https://github.com/canonical/chisel-releases/archive/${CHISEL_RELEASES_COMMIT}.tar.gz" \
    | tar -xz -C /tmp/chisel-releases --strip-components=1 \
 && mkdir -p /rootfs \
 && chisel cut --release /tmp/chisel-releases --root /rootfs \
      base-files_base base-files_release-info base-files_tmp base-files_chisel \
      libc6_libs libgcc-s1_libs libstdc++6_libs
WORKDIR /tmp/debs
RUN mkdir -p /rootfs/var/lib/dpkg/status.d \
 && zstd -dc /rootfs/var/lib/chisel/manifest.wall \
    | jq -r 'select(.kind == "package") | "\(.name) \(.version) \(.sha256)"' \
    | while read -r name version sha; do \
        apt-get download -q "${name}=${version}" || exit 1; \
        deb=$(ls "${name}"_*.deb) || exit 1; \
        echo "${sha}  ${deb}" | sha256sum -c - >/dev/null || exit 1; \
        { dpkg-deb -f "${deb}" && echo "Status: install ok installed"; } \
          > "/rootfs/var/lib/dpkg/status.d/${name}" || exit 1; \
      done \
 && ls /rootfs/var/lib/dpkg/status.d

# ---- Stage 4: runtime ------------------------------------------------------
FROM scratch AS runner
COPY --from=rootfs /rootfs/ /
COPY --from=node /opt/node/bin/node /usr/local/bin/node
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3001 \
    HOSTNAME=0.0.0.0

# `standalone/` holds the pruned node_modules alongside server.js. The app's
# `postbuild` step (scripts/copy-next-static.js) has already placed
# .next/static and public/ inside it, so this single copy is the whole
# runtime.
COPY --from=builder /app/.next/standalone ./

# Numeric on purpose: it matches the chart's runAsUser/runAsGroup and satisfies
# runAsNonRoot, which cannot resolve a name.
USER 1001:1001

EXPOSE 3001

ENTRYPOINT ["/usr/local/bin/node"]
CMD ["server.js"]
