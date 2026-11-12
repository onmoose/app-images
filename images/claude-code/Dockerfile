# syntax=docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e
# Claude Code on the moose-terminal base. The build context is this folder
# (upstream.yml says `npm:`, so there is no upstream source to fetch).
#
# This image never holds Anthropic's binary. Claude Code's license is "All
# rights reserved", and Anthropic allows running it in a hosted service, not
# handing out copies in a public image. So the image holds only the version
# number, and start.d/claude-code.sh installs that version on the box at start,
# with Anthropic's own installer (onmoose/os docs/specs/TERMINAL_APPS.md # Images).
#
# The base is pinned by tag and digest like any base image. Renovate moves it
# after a new moose-terminal is published.
FROM ghcr.io/onmoose/moose-terminal:1@sha256:92fed97db7f2e5be6f41722d08f8d385cc266d116a1be9c4a300df801576de3e

# The version upstream.yml pins (tools/build.py passes it).
ARG VERSION
COPY --from=packaging start.d/claude-code.sh /opt/moose-terminal/start.d/claude-code.sh

# DISABLE_UPDATES: Claude Code's own updates (the background one and `claude
# update`) are off. The version moves only with a new image, so the catalog
# pins it. MOOSE_TERMINAL_COMMAND: what a new session in a folder starts.
ENV CLAUDE_CODE_VERSION=${VERSION} \
    DISABLE_UPDATES=1 \
    MOOSE_TERMINAL_COMMAND=claude \
    MOOSE_TERMINAL_NAME="Claude Code"
