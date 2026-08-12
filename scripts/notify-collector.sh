#!/usr/bin/env bash
set -u

repo_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
state_dir="$repo_dir/runtime/notifications"
log_dir="$repo_dir/logs"
mkdir -p "$state_dir" "$log_dir" 2>/dev/null || true

event="${1:-status}"
cooldown=900
case "$event" in
  started)
    title="Placement collector started"
    body="The local WhatsApp collector process is running."
    urgency="normal"
    cooldown=600
    ;;
  failed)
    title="Placement collector failed"
    body="The collector service failed. Check: journalctl --user -u placement-collector -n 100"
    urgency="critical"
    cooldown=300
    ;;
  auth-required)
    title="WhatsApp login required"
    body="The placement collector needs WhatsApp authentication. Stop the service and run: npm run auth"
    urgency="critical"
    ;;
  offline)
    title="WhatsApp collector offline"
    body="WhatsApp is unavailable. Local data is safe and the collector will keep retrying."
    urgency="normal"
    ;;
  recovered)
    title="Placement collector recovered"
    body="WhatsApp collection is connected and listening again."
    urgency="normal"
    cooldown=300
    ;;
  storage-failed)
    title="Placement message could not be stored"
    body="A placement message failed local processing. Check the collector journal and local disk permissions/free space."
    urgency="critical"
    ;;
  replay-failed)
    title="Unread replay failed"
    body="Live collection remains active, but unread-message recovery failed. Check the collector journal."
    urgency="critical"
    ;;
  sync-success)
    title="Placement data sync complete"
    body="New local placement data was committed to the private data repository."
    urgency="normal"
    cooldown=3600
    ;;
  sync-failed)
    title="Placement data sync failed"
    body="Local data is safe; Git sync will retry. Check: npm run git:sync"
    urgency="critical"
    ;;
  batch-started)
    title="Placement collector batch started"
    body="The local collector started its scheduled unread replay and sync run."
    urgency="normal"
    cooldown=600
    ;;
  batch-complete)
    title="Placement collector batch complete"
    body="The scheduled local collection and private-data sync completed; the heavy process was stopped."
    urgency="normal"
    cooldown=600
    ;;
  batch-failed)
    title="Placement collector batch failed"
    body="The scheduled collection or private-data sync failed. Local data was preserved; check the batch journal."
    urgency="critical"
    cooldown=300
    ;;
  batch-ready-timeout)
    title="Placement collector readiness timeout"
    body="The scheduled collector did not become ready in time. Local data was preserved."
    urgency="critical"
    cooldown=300
    ;;
  batch-git-sync-failed)
    title="Placement batch Git sync failed"
    body="The batch stopped safely, but private-repository sync failed. Local data was preserved for retry."
    urgency="critical"
    cooldown=300
    ;;
  batch-auth-required)
    title="WhatsApp authentication required"
    body="The scheduled batch needs authentication. Run npm run auth after stopping batch mode."
    urgency="critical"
    cooldown=900
    ;;
  unreachable)
    title="Placement collector health check failed"
    body="The local health endpoint is unreachable. The watchdog will retry and may restart the service."
    urgency="critical"
    ;;
  not-ready)
    title="Placement collector not ready"
    body="The service is alive but WhatsApp collection has not become ready. Check: npm run systemd:status"
    urgency="critical"
    ;;
  watchdog-restart)
    title="Placement collector watchdog restart"
    body="The watchdog detected a persistent failure and restarted the collector service."
    urgency="critical"
    cooldown=300
    ;;
  watchdog-gave-up)
    title="Placement collector needs attention"
    body="Automatic watchdog restarts did not recover the collector. Check the user service journal."
    urgency="critical"
    cooldown=1800
    ;;
  *)
    exit 2
    ;;
esac

now=$(date +%s)
stamp_file="$state_dir/${event}.last"
last=0
if [[ -r "$stamp_file" ]]; then
  read -r last < "$stamp_file" || last=0
fi
if [[ "$last" =~ ^[0-9]+$ ]] && (( now - last < cooldown )); then
  exit 0
fi
printf '%s\n' "$now" > "$stamp_file" 2>/dev/null || true

iso=$(date --iso-8601=seconds 2>/dev/null || date)
printf '%s [%s] %s - %s\n' "$iso" "$event" "$title" "$body" >> "$log_dir/alerts.log" 2>/dev/null || true
printf '%s: %s\n' "$title" "$body" >&2

if command -v notify-send >/dev/null 2>&1; then
  notify-send --app-name="Placement Collector" --urgency="$urgency" "$title" "$body" >/dev/null 2>&1 || true
fi
