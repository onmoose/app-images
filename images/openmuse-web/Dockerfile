# syntax=docker/dockerfile:1
# Context: the OpenMuse repo at the commit in upstream.yml. nginx.conf comes from this folder.
FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS build
RUN corepack enable
WORKDIR /src
COPY . .
RUN pnpm install --frozen-lockfile
# "/" makes every API call relative (`/api/...`), so one image works on every box.
# api.ts strips the trailing slash after the `||` fallback, which "/" passes.
RUN EXPO_PUBLIC_API_URL=/ pnpm build:web

FROM nginxinc/nginx-unprivileged:1.30.5-alpine@sha256:4714e0b1b2577eaa1a6131d07c958b67f0eb68e6d0521e90c6e5287db8cf0bc5
COPY --from=packaging nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/apps/mobile/dist/web /usr/share/nginx/html
EXPOSE 8080
