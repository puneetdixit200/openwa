#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -eq 0 ]]; then
  echo "Run this installer as your normal desktop user, not root." >&2
  exit 1
fi

repo_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
node_path=$(command -v node || true)
if [[ -z "$node_path" ]]; then
  echo "node was not found on PATH." >&2
  exit 1
fi
template="$repo_dir/systemd/placement-collector.service.template"
target="$HOME/.config/systemd/user/placement-collector.service"
mkdir -p "$(dirname "$target")"

if [[ -e "$target" ]]; then
  backup="$target.backup.$(date +%Y%m%d%H%M%S)"
  cp -p "$target" "$backup"
  echo "Backed up existing unit to $backup"
fi

sed -e "s|{{REPOSITORY_PATH}}|${repo_dir//|/\\|}|g" -e "s|{{NODE_PATH}}|${node_path//|/\\|}|g" "$template" > "$target"
chmod 600 "$target"
systemctl --user daemon-reload
if command -v systemd-analyze >/dev/null 2>&1; then
  systemd-analyze --user verify "$target"
fi
echo "Installed $target"
echo "The service was not enabled or started automatically. Review it, then run:"
echo "  systemctl --user enable --now placement-collector"
