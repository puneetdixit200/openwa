#!/usr/bin/env bash
set -Eeuo pipefail

repo_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
service=placement-collector.service
started_by_batch=0
sync_completed=0
ready_observed=0
replay_completed=0
batch_result=failed
started_at=$(date +%s)
node_path=${OPENWA_BATCH_NODE_PATH:-node}

notify() {
  "$repo_dir/scripts/notify-collector.sh" "$1" >/dev/null 2>&1 || true
}

cleanup() {
  local exit_code=$?
  if (( started_by_batch == 1 )); then
    systemctl --user stop "$service" >/dev/null 2>&1 || true
  fi
  if (( exit_code == 0 && sync_completed == 1 )); then
    batch_result=success
  fi
  finished_at=$(date +%s)
  mkdir -p "$repo_dir/runtime"
  tmp="$repo_dir/runtime/last-batch.json.tmp.$$"
  printf '{"startedAt":"%s","finishedAt":"%s","durationSeconds":%s,"result":"%s","whatsappReady":%s,"unreadReplayCompleted":%s,"gitSyncStatus":"%s"}\n' \
    "$(date -d "@$started_at" --iso-8601=seconds)" "$(date -d "@$finished_at" --iso-8601=seconds)" \
    "$((finished_at - started_at))" "$batch_result" "$([[ "$ready_observed" -eq 1 ]] && echo true || echo false)" \
    "$([[ "$replay_completed" -eq 1 ]] && echo true || echo false)" "$([[ "$sync_completed" -eq 1 ]] && echo success || echo failed)" > "$tmp"
  mv -f "$tmp" "$repo_dir/runtime/last-batch.json"
  if (( exit_code == 0 && sync_completed == 1 )); then
    notify batch-complete
  elif (( exit_code != 0 )); then
    notify batch-failed
  fi
  exit "$exit_code"
}
trap cleanup EXIT

if systemctl --user is-active --quiet "$service"; then
  echo "batch run refused: $service is already active; stop continuous mode first" >&2
  notify batch-failed
  exit 1
fi

timeout_seconds=${BATCH_READY_TIMEOUT_SECONDS:-300}
min_listen_seconds=${BATCH_MIN_LISTEN_SECONDS:-60}
quiet_seconds=${BATCH_QUIET_SECONDS:-90}
max_runtime_seconds=${BATCH_MAX_RUNTIME_SECONDS:-600}
if [[ ! "$timeout_seconds" =~ ^[1-9][0-9]*$ || ! "$min_listen_seconds" =~ ^[1-9][0-9]*$ || ! "$quiet_seconds" =~ ^[1-9][0-9]*$ || ! "$max_runtime_seconds" =~ ^[1-9][0-9]*$ ]]; then
  echo "BATCH_READY_TIMEOUT_SECONDS must be a positive integer" >&2
  exit 1
fi

notify batch-started
systemctl --user start "$service"
started_by_batch=1

deadline=$((SECONDS + timeout_seconds))
runtime_deadline=$((SECONDS + max_runtime_seconds))
while (( SECONDS < deadline )); do
  if (( SECONDS >= runtime_deadline )); then
    echo "batch run exceeded maximum runtime while waiting for readiness" >&2
    exit 1
  fi
  if ! systemctl --user is-active --quiet "$service"; then
    echo "batch run failed: collector stopped before becoming ready" >&2
    exit 1
  fi
  if curl --silent --fail --max-time 5 "http://127.0.0.1:3100/ready" >/dev/null; then
    break
  fi
  sleep 2
done

if ! curl --silent --fail --max-time 5 "http://127.0.0.1:3100/ready" >/dev/null; then
  echo "batch run timed out waiting for WhatsApp readiness; local data was preserved" >&2
  exit 1
fi
ready_observed=1

echo "collector ready; draining replay and message processing"
quiet_since=$SECONDS
last_processed=""
min_deadline=$((SECONDS + min_listen_seconds))
while (( SECONDS < min_deadline || SECONDS - quiet_since < quiet_seconds )); do
  if (( SECONDS >= runtime_deadline )); then
    echo "batch run exceeded maximum runtime while draining" >&2
    exit 1
  fi
  status_values=$(curl --silent --fail --max-time 5 "http://127.0.0.1:3100/status" | "$node_path" --input-type=module -e 'let t=""; for await (const c of process.stdin) t+=c; const s=JSON.parse(t); process.stdout.write([s.connectionState,s.unreadReplayRunning,s.inFlightMessages,s.lastMessageProcessedAt ?? ""].join("\t"));') || {
    echo "batch status became unreachable while draining" >&2
    exit 1
  }
  IFS=$'\t' read -r connection_state replay_running in_flight processed_at <<< "$status_values"
  if [[ "$connection_state" != "connected" || "$replay_running" == "true" || "$in_flight" != "0" ]]; then
    quiet_since=$SECONDS
  elif [[ "$processed_at" != "$last_processed" ]]; then
    last_processed="$processed_at"
    quiet_since=$SECONDS
    replay_completed=1
  fi
  sleep 2
done

replay_completed=1
echo "message processing drained; stopping collector before Git sync"
systemctl --user stop "$service"
started_by_batch=0
stop_deadline=$((SECONDS + ${BATCH_SHUTDOWN_TIMEOUT_SECONDS:-45}))
while systemctl --user is-active --quiet "$service"; do
  if (( SECONDS >= stop_deadline )); then
    echo "collector did not stop within the shutdown timeout; local data was preserved" >&2
    exit 1
  fi
  sleep 1
done

echo "collector ready; running one explicit private-data Git sync"
npm_path=${OPENWA_BATCH_NPM_PATH:-npm}
if ! GIT_SYNC_ENABLED=true LOCAL_ONLY_MODE=false "$npm_path" run git:sync; then
  echo "batch Git sync failed; local data was preserved" >&2
  exit 1
fi
sync_completed=1
echo "batch sync complete; stopping collector until the next scheduled run"
