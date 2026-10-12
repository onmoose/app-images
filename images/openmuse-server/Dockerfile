# syntax=docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e
# Context: the OpenMuse repo at the commit in upstream.yml.
FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS build
RUN corepack enable
WORKDIR /src
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build:server
# Production dependencies of the root package only: the server needs nothing from apps/mobile.
RUN rm -rf node_modules apps/*/node_modules \
 && CI=true pnpm install --frozen-lockfile --prod --filter openmuse

FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
WORKDIR /app
COPY --from=build /src/package.json ./
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/dist ./dist
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 DATA_DIR=/data
EXPOSE 8787
# No USER line: moose runs it as the identity that owns the data bind.
CMD ["node", "dist/apps/server/src/index.js"]
