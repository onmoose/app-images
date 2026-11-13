# syntax=docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e
# OpenCode on the moose-terminal base. The build context is this folder
# (upstream.yml says `npm:`, so there is no upstream source to fetch).
#
# OpenCode has an official web UI (`opencode web`, port 4096), so the image runs
# that server instead of the base's project page and ttyd. The base is kept for
# its tools: git, gh, Node, Python, ripgrep and mise. Upstream's own image has
# none of them, and an agent that cannot run git or a project's runtime cannot
# work on a project.
#
# MIT, so the pinned binary lives in the image: a box does not download the CLI,
# and the catalog version is the bytes on disk. This is the opposite of
# images/claude-code, whose license allows running but not handing out copies.
FROM ghcr.io/onmoose/moose-terminal:1@sha256:92fed97db7f2e5be6f41722d08f8d385cc266d116a1be9c4a300df801576de3e

ARG VERSION
# The base sets NPM_CONFIG_PREFIX to the home, so a plain `npm install -g` would
# land in the data bind. Install into /usr/local: the CLI belongs to the image,
# and the home stays the user's (logins, provider packages, mise installs).
RUN NPM_CONFIG_PREFIX=/usr/local npm install -g "opencode-ai@${VERSION}" \
    && opencode --version

# HOME is /moose, not the base's /home/moose: OpenCode's folder picker starts in
# HOME, and the folders moose mounts are /moose/projects and /moose/extra/<Name>.
# PATH and NPM_CONFIG_PREFIX follow HOME, so `npm i -g` and mise keep writing
# into the persisted data dir, where they survive a restart.
ENV HOME=/moose \
    NPM_CONFIG_PREFIX=/moose/.local \
    PATH=/moose/.local/bin:/moose/.local/share/mise/shims:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# tini is the base's PID 1. An agent leaves processes behind when a shell ends,
# and tini reaps them.
ENTRYPOINT ["/usr/bin/tini", "--", "opencode"]
# The probe starts the image with no command, and so does a box whose compose
# sets none. The catalog compose may override it with `command:`.
CMD ["web", "--port", "4096", "--hostname", "0.0.0.0"]
EXPOSE 4096
