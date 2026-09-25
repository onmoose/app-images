# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# Context: the opendray repo at the commit in upstream.yml.
#
# opendray ships no Dockerfile of its own (its README says Docker is not a
# supported deploy path for v2.x; see the folder's upstream.yml for why that
# does not apply to moose's shape). This Dockerfile is ours: it runs
# upstream's own documented build (`pnpm build` in app/web, then
# `go build ./cmd/opendray`), never a source patch.
#
# Build stage: pnpm builds the React SPA that Go's build embeds via
# go:embed, then `go build` compiles the single opendray binary.
FROM node:22.23.3-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c AS node
FROM golang:1.25.14-bookworm@sha256:3b4a11519ad929d1e1d261a12cff056f0c85b735253d7d861346b9c6f8b36437 AS build
# Node 22 + npm/corepack, only to run `pnpm build` in this stage. bookworm's
# own nodejs apt package is version 18, too old for opendray's pinned
# engine, so this copies the same pinned node:22-bookworm-slim install this
# Dockerfile's runtime stage already uses, instead of a second internet
# fetch (NodeSource, nvm) for the same version.
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
# node's own image ships npm/npx/corepack as bin symlinks into
# node_modules; recreate them rather than COPY, which would dereference
# the symlink and copy its target's content to the wrong path, breaking
# its own relative `require`.
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && ln -s ../lib/node_modules/corepack/dist/corepack.js /usr/local/bin/corepack
# Pin pnpm the same way opendray's own CI does (package.json
# "packageManager": "pnpm@10.27.0"), via corepack rather than a floating
# `npm install -g pnpm`.
RUN corepack enable && corepack prepare pnpm@10.27.0 --activate
WORKDIR /src
COPY . .
RUN cd app/web && pnpm install --frozen-lockfile && pnpm build
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /out/opendray ./cmd/opendray

# Runtime stage: node:22-bookworm-slim, not the smaller -alpine, because the
# CLIs opendray spawns (Claude Code, Codex, OpenCode) are installed at
# runtime with `npm i -g` and some ship native/prebuilt bits that expect
# glibc, not musl.
FROM node:22.23.3-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c
# git: opendray shells out to it for project/session status.
# ripgrep: opendray's own /search endpoint execs `rg`; without it the
# endpoint answers 501 (admissibility gate, Gate B).
# postgresql-client-17: opendray's pre-migrate backup runs `pg_dump`, which
# must match the server's major version (docs/operator-guide.md). Debian
# bookworm's own postgresql-client package is version 15, so this pulls the
# PGDG apt repo for a real 17 client rather than mismatching the managed
# pgvector/pgvector:pg17 sidecar the catalog compose bundles.
# ca-certificates + gnupg: needed to add and verify the PGDG repo.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates gnupg git ripgrep curl \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update && apt-get install -y --no-install-recommends postgresql-client-17 \
    && apt-get purge -y gnupg curl && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/opendray /usr/local/bin/opendray
# Bind to every interface: upstream's own default (127.0.0.1:8770) is a
# loopback-only address meant for a host install fronted by a reverse proxy
# on the same machine (README # Production deploy). moose's Caddy fronts the
# container from outside it, so opendray must listen on all interfaces or
# nothing outside the container can ever reach it (admissibility gate, Gate
# B: "Set OPENDRAY_LISTEN=0.0.0.0:8770").
ENV OPENDRAY_LISTEN=0.0.0.0:8770
# HOME and NPM_CONFIG_PREFIX point at the data bind (./data/home in the
# catalog compose) so a CLI login (~/.claude), an `npm i -g` CLI install,
# and each provider's in-UI "Update" button survive a restart (gate finding).
ENV HOME=/data/home NPM_CONFIG_PREFIX=/data/home/.npm-global
ENV PATH=/data/home/.npm-global/bin:$PATH
EXPOSE 8770
# No USER line: moose runs it as the identity that owns the data bind, and
# opendray itself never self-chowns or drops privilege on the boot path
# (admissibility gate, Gate B probe: clean boot as uid 10001 and as root).
# No -config flag: with none given, opendray runs in env-only mode (reads
# OPENDRAY_* straight from the environment), same as its own systemd unit
# would need a config.toml for. The catalog compose overrides `command:` to
# run `migrate` before `serve`, as upstream's systemd unit's ExecStartPre
# does (README, docs/operator-guide.md).
ENTRYPOINT ["/usr/local/bin/opendray"]
CMD ["serve"]
