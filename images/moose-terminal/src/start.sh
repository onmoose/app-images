#!/bin/bash
# The start script of every terminal app image.
set -euo pipefail

# HOME is the app's persisted data dir (logins, mise installs, shell history).
# moose binds it and chowns it to the runtime uid.
mkdir -p "$HOME" "$HOME/.local/bin" 2>/dev/null || true
if [ ! -w "$HOME" ]; then
  echo "error: HOME ($HOME) is not writable by uid $(id -u). The app's data dir must be bound there." >&2
  exit 1
fi

# moose runs the app as a uid with no line in /etc/passwd. Some tools refuse that
# (ssh: "No user exists for uid"; Node's os.userInfo() throws). nss_wrapper gives
# the uid a name from a file in /tmp, with no root needed.
if ! getent passwd "$(id -u)" >/dev/null; then
  mkdir -p /tmp/moose-terminal
  cp /etc/passwd /tmp/moose-terminal/passwd
  cp /etc/group /tmp/moose-terminal/group
  echo "moose:x:$(id -u):$(id -g):moose:$HOME:/bin/bash" >> /tmp/moose-terminal/passwd
  getent group "$(id -g)" >/dev/null || echo "moose:x:$(id -g):" >> /tmp/moose-terminal/group
  export LD_PRELOAD=libnss_wrapper.so NSS_WRAPPER_PASSWD=/tmp/moose-terminal/passwd NSS_WRAPPER_GROUP=/tmp/moose-terminal/group
fi

# A CLI image adds its own steps here (Claude Code installs its pinned version).
# A failed step is logged and the terminal still starts, so the user can see
# the error and use the shell.
for step in /opt/moose-terminal/start.d/*.sh; do
  [ -e "$step" ] || continue
  echo "start step: $step"
  bash "$step" || echo "warning: start step $step failed (exit $?)" >&2
done

exec node /opt/moose-terminal/server.js
