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
npm_path=$(command -v npm || true)
if [[ -z "$npm_path" ]]; then
  echo "npm was not found on PATH." >&2
  exit 1
fi

unit_dir="$HOME/.config/systemd/user"
mkdir -p "$unit_dir"

backup_if_present() {
  local target=$1
  if [[ -e "$target" ]]; then
    local backup="$target.backup.$(date +%Y%m%d%H%M%S)"
    cp -p "$target" "$backup"
    echo "Backed up existing unit to $backup"
  fi
}

render_unit() {
  local template=$1
  local target=$2
  backup_if_present "$target"
  sed \
    -e "s|{{REPOSITORY_PATH}}|${repo_dir//|/\\|}|g" \
    -e "s|{{NODE_PATH}}|${node_path//|/\\|}|g" \
    -e "s|{{NPM_PATH}}|${npm_path//|/\\|}|g" \
    "$template" > "$target"
  chmod 600 "$target"
}

render_unit "$repo_dir/systemd/placement-collector.service.template" "$unit_dir/placement-collector.service"
render_unit "$repo_dir/systemd/placement-collector-failure.service.template" "$unit_dir/placement-collector-failure.service"
render_unit "$repo_dir/systemd/placement-collector-watchdog.service.template" "$unit_dir/placement-collector-watchdog.service"
render_unit "$repo_dir/systemd/placement-collector-watchdog.timer.template" "$unit_dir/placement-collector-watchdog.timer"
render_unit "$repo_dir/systemd/placement-collector-batch.service.template" "$unit_dir/placement-collector-batch.service"
render_unit "$repo_dir/systemd/placement-collector-batch.timer.template" "$unit_dir/placement-collector-batch.timer"

systemctl --user daemon-reload
if command -v systemd-analyze >/dev/null 2>&1; then
  systemd-analyze --user verify \
    "$unit_dir/placement-collector.service" \
    "$unit_dir/placement-collector-failure.service" \
    "$unit_dir/placement-collector-watchdog.service" \
    "$unit_dir/placement-collector-watchdog.timer" \
    "$unit_dir/placement-collector-batch.service" \
    "$unit_dir/placement-collector-batch.timer"
fi

echo "Installed collector, watchdog, and three-hour batch user units."
echo "They were not enabled or started automatically. Review them, then run:"
echo "  systemctl --user enable --now placement-collector.service placement-collector-watchdog.timer"
echo "For low-memory batch mode, disable the continuous collector first, then run:"
echo "  systemctl --user disable --now placement-collector.service placement-collector-watchdog.timer"
echo "  systemctl --user enable --now placement-collector-batch.timer"
