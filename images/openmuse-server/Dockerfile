# syntax=docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e
# Context: the OpenMuse repo at the commit in upstream.yml.
FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS build
RUN corepack enable
WORKDIR /src
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build:server
# Production dependencies of the root package only: the server needs nothing from apps/mobile.
RUN rm -rf node_modules apps/*/node_modules \
 && CI=true pnpm install --frozen-lockfile --prod --filter openmuse

FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205
WORKDIR /app
COPY --from=build /src/package.json ./
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/dist ./dist
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 DATA_DIR=/data
EXPOSE 8787
# No USER line: moose runs it as the identity that owns the data bind.
CMD ["node", "dist/apps/server/src/index.js"]
