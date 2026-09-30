# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# Context: the Ditto repo at the commit in upstream.yml. nginx.conf comes from this folder.
FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS build
WORKDIR /src
COPY . .
# `npm ci` installs exactly what package-lock.json says. Upstream's own
# `npm run build` runs `npm i` first, which can change the lockfile, so we run
# the steps of that script directly, in the same order. There is no ditto.json,
# so every default stays as upstream compiled it.
RUN npm ci --no-audit --no-fund \
 && npx vite build -l error \
 && cp dist/index.html dist/404.html \
 && npm run librejs:check

# nginx-unprivileged listens on 8080, keeps its temp files under /tmp and runs
# as a plain user, so it needs no chown and no extra capability.
FROM nginxinc/nginx-unprivileged:1.31.6-alpine@sha256:6a23acdfca2b9cfbcec61419e3f1426bcbedb91362f2f19306a8567423bb4612
COPY --from=packaging nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist /usr/share/nginx/html
EXPOSE 8080
