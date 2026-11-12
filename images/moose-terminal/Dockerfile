# syntax=docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e
# moose-terminal: the base image of every moose terminal app. It has no upstream:
# the project page, the start script and the key bar in src/ are ours. The build
# context is this folder (upstream.yml says `source: own`).
#
# Node is the base because the page server and many CLIs (Codex, grok-cli) need
# it. Node 24 is the current LTS line.
FROM node:24.22.3-trixie-slim@sha256:af02d57b57719b9657a45199a79264a9437940cd55b3c7b3fc99615654f124a0

# Debian packages:
# - tmux: one session per folder, kept when the tab closes.
# - git, openssh-client, ripgrep, curl, python3 (with venv): the tools an agent expects.
# - less, nano, procps, jq, unzip, xz-utils, bzip2, zstd: everyday tools, and what
#   mise and installers unpack with.
# - libnss-wrapper: a name for a uid with no /etc/passwd line (see start.sh).
# - tini: PID 1. It reaps processes an agent leaves behind when their shell ends.
# There is no apt at run time (no root, no capabilities), so what is here is
# what the user has. Other languages install with mise into the home.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ca-certificates curl git openssh-client ripgrep tmux python3 python3-venv \
       less nano procps jq unzip xz-utils bzip2 zstd libnss-wrapper tini \
    && rm -rf /var/lib/apt/lists/*

# Three tools Debian trixie does not ship, or ships too old, come from their own
# GitHub releases. Renovate moves each version (the regex manager for
# `# renovate:` comments in renovate.json). Each download is checked against
# the checksum file of the same release, which catches a broken download.
# - ttyd: not in trixie. Serves xterm.js and connects it to a command over a WebSocket.
# - gh: trixie has 2.46 from 2024. `gh auth login` is how a user reaches private repos.
# - mise: not in trixie. Installs Go, Rust, newer Python and more into the home, without root.
# renovate: datasource=github-releases depName=tsl0922/ttyd
ARG TTYD_VERSION=1.7.7
# renovate: datasource=github-releases depName=cli/cli
ARG GH_VERSION=v2.103.3
# renovate: datasource=github-releases depName=jdx/mise
ARG MISE_VERSION=v2026.11.7
RUN set -eux; cd /tmp; \
    curl -fsSLO "https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.x86_64"; \
    curl -fsSLO "https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/SHA256SUMS"; \
    grep ' ttyd.x86_64$' SHA256SUMS | sha256sum -c -; \
    install -m 0755 ttyd.x86_64 /usr/local/bin/ttyd; \
    gh="gh_${GH_VERSION#v}_linux_amd64"; \
    curl -fsSLO "https://github.com/cli/cli/releases/download/${GH_VERSION}/${gh}.tar.gz"; \
    curl -fsSLO "https://github.com/cli/cli/releases/download/${GH_VERSION}/gh_${GH_VERSION#v}_checksums.txt"; \
    grep " ${gh}.tar.gz$" "gh_${GH_VERSION#v}_checksums.txt" | sha256sum -c -; \
    tar -xzf "${gh}.tar.gz"; install -m 0755 "${gh}/bin/gh" /usr/local/bin/gh; \
    mise="mise-${MISE_VERSION}-linux-x64"; \
    curl -fsSLO "https://github.com/jdx/mise/releases/download/${MISE_VERSION}/${mise}"; \
    curl -fsSLO "https://github.com/jdx/mise/releases/download/${MISE_VERSION}/SHASUMS256.txt"; \
    grep " \./${mise}$\| ${mise}$" SHASUMS256.txt | sed 's# \./# #' | sha256sum -c -; \
    install -m 0755 "${mise}" /usr/local/bin/mise; \
    rm -rf /tmp/*; \
    ttyd --version; gh --version; mise --version

COPY --from=packaging src/ /opt/moose-terminal/
# The node image's own user (uid 1000) is removed. moose runs the app as the
# owner's uid, often 1000, and ssh takes its home from /etc/passwd, so a
# leftover "node" line would point ssh at /home/node. start.sh names the uid.
RUN userdel node \
    && chmod 0755 /opt/moose-terminal/start.sh /opt/moose-terminal/session.sh \
    && cat /opt/moose-terminal/bashrc >> /etc/bash.bashrc \
    && mkdir -p /opt/moose-terminal/start.d

# HOME is the persisted data dir. moose binds it and chowns it to the runtime
# uid. The tools that install "for the user" go there too: npm -g into
# ~/.local, mise into ~/.local/share/mise, and a CLI's own installer into
# ~/.local/bin. PATH names them, since a login shell would reset it (see
# session.sh). Python packages go in a venv (python3 -m venv): Debian's Python
# refuses pip installs outside one.
# /moose/projects and /moose/extra are not made here. Only the folders moose
# binds exist, so a folder the user skipped does not show on the page.
ENV HOME=/home/moose \
    NPM_CONFIG_PREFIX=/home/moose/.local \
    PATH=/home/moose/.local/bin:/home/moose/.local/share/mise/shims:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    SHELL=/bin/bash \
    LANG=C.UTF-8 \
    TERM=xterm-256color

EXPOSE 7681
ENTRYPOINT ["/usr/bin/tini", "--", "/opt/moose-terminal/start.sh"]
