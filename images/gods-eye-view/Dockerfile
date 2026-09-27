# syntax=docker/dockerfile:1
#
# Upstream has no image and no Dockerfile: the Vite dev server IS the app. It
# serves the client and runs every API proxy (ADS-B, AIS, Overpass, OpenAI
# Realtime, ...) as middleware, so there is nothing to build and nothing else
# to package. Upstream's own Pinokio launcher runs `npm run dev`; so does this
# image. `vite preview` cannot stand in: the two browser keys are compiled
# into the bundle with Vite `define`, so a built bundle can't take them at
# runtime.
FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6

# Puppeteer is only used by the QA scripts; skip its ~150MB Chromium download.
ENV PUPPETEER_SKIP_DOWNLOAD=1
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# moose picks the runtime identity and chowns the data dirs (.gev-cache,
# .gev-logs) to it, but node_modules is baked in as root at build time. Vite
# only needs to write its dep-optimizer cache, so open up those two
# directories rather than chowning a few hundred MB to a UID we cannot know
# at build time. Same fix upstream's own unmerged Docker PR (#208) uses.
RUN mkdir -p node_modules/.vite && chmod 777 node_modules node_modules/.vite

COPY . .

# Bind to all interfaces, otherwise moose's proxy hits nothing. Vite also
# relaxes allowedHosts when HOST is 0.0.0.0, which is what lets the box's own
# host name reach it.
ENV HOST=0.0.0.0
ENV PORT=4173
EXPOSE 4173
CMD ["npm", "run", "dev"]
