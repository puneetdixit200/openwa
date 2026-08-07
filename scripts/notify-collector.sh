#!/usr/bin/env bash
set -u

event="${1:-status}"
case "$event" in
  started)
    title="Placement collector started"
    body="The local WhatsApp collector process is running."
    urgency="normal"
    ;;
  failed)
    title="Placement collector failed"
    body="The collector service failed. Check: journalctl --user -u placement-collector -n 100"
    urgency="critical"
    ;;
  *)
    exit 2
    ;;
esac

if command -v notify-send >/dev/null 2>&1; then
  notify-send --app-name="Placement Collector" --urgency="$urgency" "$title" "$body" >/dev/null 2>&1 || true
fi
