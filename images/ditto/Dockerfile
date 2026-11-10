# syntax=docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e
# Context: the Ditto repo at the commit in upstream.yml. nginx.conf comes from this folder.
FROM node:24.22.2-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9 AS build
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
