# syntax=docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e
# Context: the OpenMuse repo at the commit in upstream.yml. nginx.conf comes from this folder.
FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS build
RUN corepack enable
WORKDIR /src
COPY . .
RUN pnpm install --frozen-lockfile
# "/" makes every API call relative (`/api/...`), so one image works on every box.
# api.ts strips the trailing slash after the `||` fallback, which "/" passes.
RUN EXPO_PUBLIC_API_URL=/ pnpm build:web

FROM nginxinc/nginx-unprivileged:1.31.6-alpine@sha256:884e0b7f42f303641b0f4e78755aea647521dca0b89ca3be7992ad78b5c07434
COPY --from=packaging nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/apps/mobile/dist/web /usr/share/nginx/html
EXPOSE 8080
