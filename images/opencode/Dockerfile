# syntax=docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e
# OpenCode on the moose-terminal base. The build context is this folder
# (upstream.yml says `npm:`, so there is no upstream source to fetch).
#
# OpenCode has an official web UI (`opencode serve`, the v2 API and web server),
# so the image runs that server instead of the base's project page and ttyd. The
# base is kept for its tools: git, gh, Node, Python, ripgrep and mise. Upstream's
# own image has none of them, and an agent that cannot run git or a project's
# runtime cannot work on a project.
#
# MIT, so the pinned binary lives in the image: a box does not download the CLI,
# and the catalog version is the bytes on disk. This is the opposite of
# images/claude-code, whose license allows running but not handing out copies.
FROM ghcr.io/onmoose/moose-terminal:1@sha256:92fed97db7f2e5be6f41722d08f8d385cc266d116a1be9c4a300df801576de3e

ARG VERSION
# OpenCode 2.x is the npm package @opencode/cli (opencode-ai holds only 1.x).
# Its postinstall picks the native binary for the platform and links it to
# bin/opencode.exe. `--allow-scripts` says we want that script to run: npm
# warns about install scripts it was not told to allow.
# The base sets NPM_CONFIG_PREFIX to the home, so a plain `npm install -g` would
# land in the data bind. Install into /usr/local: the CLI belongs to the image,
# and the home stays the user's (logins, provider packages, mise installs).
# npm also installs the two musl builds (for Alpine), about 240 MB each. This
# image is Debian (glibc), so the postinstall never picks them, and they are
# removed in the same step so they do not stay in a layer.
RUN NPM_CONFIG_PREFIX=/usr/local npm install -g --allow-scripts=@opencode/cli "@opencode/cli@${VERSION}" \
    && rm -rf /usr/local/lib/node_modules/@opencode/cli/node_modules/@opencode/cli-linux-*-musl \
    && opencode --version

# OpenCode's server always asks for a password, and has no switch to turn that
# off. moose already puts the app behind the box login, so the password would be
# a second login. start.sh runs OpenCode on 127.0.0.1:4097 with a random
# password, and proxy.js serves port 4096 and adds that password to every
# request. See both files.
COPY --from=packaging start.sh proxy.js /opt/opencode/
RUN chmod 0755 /opt/opencode/start.sh

# HOME is /moose, not the base's /home/moose: OpenCode's folder picker starts in
# HOME, and the folders moose mounts are /moose/projects and /moose/extra/<Name>.
# PATH and NPM_CONFIG_PREFIX follow HOME, so `npm i -g` and mise keep writing
# into the persisted data dir, where they survive a restart.
# OPENCODE_DISABLE_AUTOUPDATE: OpenCode's own updates are off. The version moves
# only with a new image, so the catalog pins it.
ENV HOME=/moose \
    NPM_CONFIG_PREFIX=/moose/.local \
    PATH=/moose/.local/bin:/moose/.local/share/mise/shims:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    OPENCODE_DISABLE_AUTOUPDATE=1

# tini is the base's PID 1. An agent leaves processes behind when a shell ends,
# and tini reaps them.
ENTRYPOINT ["/usr/bin/tini", "--", "/opt/opencode/start.sh"]
EXPOSE 4096
