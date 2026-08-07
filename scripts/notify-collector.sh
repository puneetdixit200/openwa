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
  sync-success)
    title="Placement data sync complete"
    body="New local placement data was committed to the private data repository."
    urgency="normal"
    ;;
  sync-failed)
    title="Placement data sync failed"
    body="Local data is safe; Git sync will retry. Check: npm run git:sync"
    urgency="critical"
    ;;
  *)
    exit 2
    ;;
esac

if command -v notify-send >/dev/null 2>&1; then
  notify-send --app-name="Placement Collector" --urgency="$urgency" "$title" "$body" >/dev/null 2>&1 || true
fi
