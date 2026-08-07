#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -eq 0 ]]; then
  echo "Run this uninstaller as your normal desktop user, not root." >&2
  exit 1
fi

unit_dir="$HOME/.config/systemd/user"
target="$unit_dir/placement-collector.service"
failure_target="$unit_dir/placement-collector-failure.service"
watchdog_target="$unit_dir/placement-collector-watchdog.service"
watchdog_timer="$unit_dir/placement-collector-watchdog.timer"

if [[ ! -e "$target" && ! -e "$watchdog_timer" ]]; then
  echo "No placement-collector user units found."
  exit 0
fi

systemctl --user disable --now placement-collector-watchdog.timer 2>/dev/null || true
systemctl --user stop placement-collector-watchdog.service 2>/dev/null || true
systemctl --user disable --now placement-collector.service 2>/dev/null || true
rm -f "$target" "$failure_target" "$watchdog_target" "$watchdog_timer"
systemctl --user daemon-reload
systemctl --user reset-failed placement-collector.service 2>/dev/null || true
echo "Removed placement collector and watchdog user units."
