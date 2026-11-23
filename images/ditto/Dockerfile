# syntax=docker/dockerfile:1@sha256:572cebbc2b15e6f84c077742952674889cb63cd5e9b80abdffcbe587b6f19183
# Context: the Ditto repo at the commit in upstream.yml. nginx.conf comes from this folder.
FROM node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS build
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
FROM nginxinc/nginx-unprivileged:1.31.7-alpine@sha256:b5047b9b76845eac124358373c6852377c52e4b05834a47647e955dd91cb8f1e
COPY --from=packaging nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist /usr/share/nginx/html
EXPOSE 8080
