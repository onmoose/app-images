# syntax=docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e
# Context: the OpenMuse repo at the commit in upstream.yml. nginx.conf comes from this folder.
FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS build
RUN corepack enable
WORKDIR /src
COPY . .
RUN pnpm install --frozen-lockfile
# "/" makes every API call relative (`/api/...`), so one image works on every box.
# api.ts strips the trailing slash after the `||` fallback, which "/" passes.
RUN EXPO_PUBLIC_API_URL=/ pnpm build:web

FROM nginxinc/nginx-unprivileged:1.31.7-alpine@sha256:b5047b9b76845eac124358373c6852377c52e4b05834a47647e955dd91cb8f1e
COPY --from=packaging nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/apps/mobile/dist/web /usr/share/nginx/html
EXPOSE 8080
