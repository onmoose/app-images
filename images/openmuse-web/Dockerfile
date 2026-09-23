# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# Context: the OpenMuse repo at the commit in upstream.yml. nginx.conf comes from this folder.
FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS build
RUN corepack enable
WORKDIR /src
COPY . .
RUN pnpm install --frozen-lockfile
# "/" makes every API call relative (`/api/...`), so one image works on every box.
# api.ts strips the trailing slash after the `||` fallback, which "/" passes.
RUN EXPO_PUBLIC_API_URL=/ pnpm build:web

FROM nginxinc/nginx-unprivileged:1.31.6-alpine@sha256:6a23acdfca2b9cfbcec61419e3f1426bcbedb91362f2f19306a8567423bb4612
COPY --from=packaging nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/apps/mobile/dist/web /usr/share/nginx/html
EXPOSE 8080
