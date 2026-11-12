#!/bin/bash
# What a new tmux session runs. A CLI image sets MOOSE_TERMINAL_COMMAND (for
# example "claude"), and the session starts it in the folder. When it exits, or
# when no command is set, the session is a plain shell in the same folder.
#
# No login shell (bash -l): Debian's /etc/profile resets PATH, and the image's
# PATH holds the home's bin folders. An interactive bash still reads
# /etc/bash.bashrc and ~/.bashrc.
if [ -n "${MOOSE_TERMINAL_COMMAND:-}" ]; then
  bash -c "$MOOSE_TERMINAL_COMMAND"
  echo
  echo "$MOOSE_TERMINAL_COMMAND has ended. This is a shell in the same folder. Type $MOOSE_TERMINAL_COMMAND to start it again."
fi
exec bash
