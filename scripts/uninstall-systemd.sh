#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -eq 0 ]]; then
  echo "Run this uninstaller as your normal desktop user, not root." >&2
  exit 1
fi

target="$HOME/.config/systemd/user/placement-collector.service"
failure_target="$HOME/.config/systemd/user/placement-collector-failure.service"
if [[ ! -e "$target" ]]; then
  echo "No placement-collector user unit found."
  exit 0
fi
systemctl --user disable --now placement-collector.service 2>/dev/null || true
rm -f "$target"
rm -f "$failure_target"
systemctl --user daemon-reload
echo "Removed $target"
