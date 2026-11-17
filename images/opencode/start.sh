#!/bin/bash
# The start script of the OpenCode image. It starts two processes:
# - OpenCode's server on 127.0.0.1:4097, with a random password.
# - proxy.js on port 4096, the port moose routes to. It adds the password to
#   every request, so the user never sees OpenCode's own login. moose already
#   puts the app behind the box login.
# When either process exits, this script stops the other one and exits, so the
# container stops and moose restarts it.
set -euo pipefail

# HOME is the app's persisted data dir. moose binds it and chowns it to the
# runtime uid. Same check as the moose-terminal start script.
mkdir -p "$HOME" 2>/dev/null || true
if [ ! -w "$HOME" ]; then
  echo "error: HOME ($HOME) is not writable by uid $(id -u). The app's data dir must be bound there." >&2
  exit 1
fi

# moose runs the app as a uid with no line in /etc/passwd. Some tools refuse that
# (ssh: "No user exists for uid"; Node's os.userInfo() throws). nss_wrapper gives
# the uid a name from a file in /tmp, with no root needed. Copied from the
# moose-terminal start script, which this image does not run.
if ! getent passwd "$(id -u)" >/dev/null; then
  mkdir -p /tmp/moose-terminal
  cp /etc/passwd /tmp/moose-terminal/passwd
  cp /etc/group /tmp/moose-terminal/group
  echo "moose:x:$(id -u):$(id -g):moose:$HOME:/bin/bash" >> /tmp/moose-terminal/passwd
  getent group "$(id -g)" >/dev/null || echo "moose:x:$(id -g):" >> /tmp/moose-terminal/group
  export LD_PRELOAD=libnss_wrapper.so NSS_WRAPPER_PASSWD=/tmp/moose-terminal/passwd NSS_WRAPPER_GROUP=/tmp/moose-terminal/group
fi

# A new password on every start. It is never shown, logged or written to disk.
# OpenCode takes it from OPENCODE_PASSWORD, and proxy.js reads the same
# variable. The shells in OpenCode's terminal panel also get it in their
# environment. That gives them nothing new: they run as the same uid, which can
# read it from /proc anyway, and it only guards a server on 127.0.0.1 inside the
# container. OPENCODE_SERVER_PASSWORD is the other name OpenCode reads, after
# OPENCODE_PASSWORD, so it is cleared.
OPENCODE_PASSWORD=$(head -c 32 /dev/urandom | base64 | tr -d '/+=\n')
export OPENCODE_PASSWORD
unset OPENCODE_SERVER_PASSWORD

pids=()
stop() {
  kill "${pids[@]}" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap 'stop; exit 143' TERM INT

opencode serve --hostname 127.0.0.1 --port 4097 &
pids+=("$!")

# Wait until OpenCode answers with the password. curl reads the password from
# stdin, so it does not show in the process list.
ask() {
  printf 'user = "opencode:%s"\n' "$OPENCODE_PASSWORD" | curl -K - -fsS -o /dev/null --max-time 3 "$1"
}
for _ in $(seq 120); do
  kill -0 "${pids[0]}" 2>/dev/null || { echo "error: opencode serve exited before it answered" >&2; exit 1; }
  ask http://127.0.0.1:4097/api/session 2>/dev/null && break
  sleep 0.5
done

node /opt/opencode/proxy.js &
pids+=("$!")

# Check the whole path once: a request with no password, through the proxy,
# must reach the API. The image probe waits for this line.
for _ in $(seq 60); do
  if curl -fsS -o /dev/null --max-time 3 http://127.0.0.1:4096/api/session 2>/dev/null; then
    echo "opencode: the API answers through the proxy on port 4096"
    break
  fi
  sleep 0.5
done

# Wait for the first of the two to exit, then stop the other one.
status=0
wait -n "${pids[@]}" || status=$?
echo "error: a process exited (status $status), stopping the container" >&2
stop
# Exit non-zero, so a restart policy of on-failure restarts it too.
[ "$status" -ne 0 ] || status=1
exit "$status"
