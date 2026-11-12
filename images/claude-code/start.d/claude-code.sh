#!/bin/bash
# Install the Claude Code version this image pins (CLAUDE_CODE_VERSION) into the
# persisted home, when the home holds another version or none. So a new image
# with a new pin updates the CLI, and an older image puts the older one back.
# The image itself never holds Anthropic's binary: the box downloads it from
# Anthropic with Anthropic's own native installer.
set -euo pipefail

want="$CLAUDE_CODE_VERSION"
saved="$HOME/.local/state/moose-terminal/claude-code-version"
if [ "$(cat "$saved" 2>/dev/null)" = "$want" ] && [ -x "$HOME/.local/bin/claude" ]; then
  echo "Claude Code $want is installed, as pinned"
  exit 0
fi

echo "Installing Claude Code $want with Anthropic's installer"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL --retry 3 https://claude.ai/install.sh -o "$tmp/install.sh"
# DISABLE_UPDATES (set in the image) also blocks `claude install`, which the
# installer runs. It is lifted for this one command only.
env -u DISABLE_UPDATES bash "$tmp/install.sh" "$want"

got=$("$HOME/.local/bin/claude" --version | awk '{print $1}')
if [ "$got" != "$want" ]; then
  echo "error: the installer left Claude Code $got, not $want" >&2
  exit 1
fi
mkdir -p "$(dirname "$saved")"
echo "$want" > "$saved"
echo "Claude Code $want is installed, as pinned"
