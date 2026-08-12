# WhatsApp Placement Collector

This project is a local-first, read-only ingestion layer for selected WhatsApp placement groups. It stores new text messages and supported attachments in date-based folders using `Asia/Kolkata`, hashes chat and sender identifiers, deduplicates messages, and optionally syncs the private raw archive to a separate Git repository.

It never sends, replies to, reacts to, forwards, edits, or deletes WhatsApp messages. It does not classify companies, extract job descriptions, generate websites, or call OpenAI.

## Privacy model

Keep the code repository separate from the private raw-data repository. Never use a public repository for raw placement data. `.env`, `.local-session/`, runtime state, logs, and raw data are ignored by the code repository. The collector never logs phone numbers, raw WhatsApp IDs, QR data, message contents, tokens, or session payloads.

WhatsApp needs an internet connection to deliver messages. Local storage continues to work without GitHub. GitHub sync is optional and can be performed later. Unread replay is best effort; messages received while the laptop was fully offline are not guaranteed to be recoverable.

## Reliability model

The collector is designed to fail visibly instead of silently:

- WhatsApp reconnects with bounded exponential backoff.
- Expired authentication becomes `auth_required` instead of deleting the local session.
- Message-processing/storage failures trigger a critical local alert.
- Git failures never stop local collection and trigger a critical local alert.
- `systemd` restarts the collector after process crashes.
- An independent watchdog checks the local health endpoint every two minutes.
- After three consecutive unreachable health checks, the watchdog restarts the collector.
- Automatic watchdog restarts are capped at three until the service becomes ready again, preventing an endless restart loop.
- Authentication-required and ordinary network-offline states are never "fixed" by pointless restart loops.
- Alerts are rate-limited, written persistently to `logs/alerts.log`, and also sent through `notify-send` when desktop notifications are available.

No software can guarantee recovery from power loss, disk failure, WhatsApp account restrictions, or messages that never reach the laptop. The goal here is bounded recovery, durable local writes, and loud failure reporting rather than magical immortality.

## Requirements

Linux, Node.js 20+, and Git. The collector uses the Baileys WhatsApp protocol client, so it does not launch Chrome, Brave, or any normal browser profile. Use a private raw-data Git repository if manual sync is enabled.

## Installation

```bash
git clone https://github.com/puneetdixit200/openwa.git
cd openwa
npm install
npm run build
```

Create `.env` from `.env.example` with `npm run setup`, or use the existing local configuration. Never commit `.env`.

## First authentication and group selection

The background service must not own the session during interactive commands:

```bash
systemctl --user stop placement-collector.service
cd /home/pd/openwa
npm run auth
npm run groups:select
```

`npm run auth` builds the local client and prints a QR code only in your local terminal. Scan it using WhatsApp → Linked devices → Link a device. The command does not send messages or select groups. It creates a new protected Baileys credential subdirectory inside `.local-session/` and never deletes the prior OpenWA browser profile. `groups:select` prints group names only, accepts comma-separated indexes, asks for confirmation, and stores exact IDs without displaying them.

If authentication expires, the background collector reports `auth_required`, creates a local desktop/persistent alert, and tells you to run `npm run auth`; it does not print a QR or delete credentials in the background. `OPENWA_HEADLESS`, `OPENWA_BROWSER_PATH`, and `OPENWA_CUSTOM_USER_AGENT` remain in existing `.env` files for compatibility but are no longer used by the protocol client.

## Fully local-only operation

Use this when GitHub must not be part of normal collection:

```env
LOCAL_ONLY_MODE=true
GIT_SYNC_ENABLED=false
OPENWA_AUTO_RECONNECT=true
OPENWA_BACKGROUND_AUTH_MODE=existing-session-only
OPENWA_HEADLESS=true
```

Messages and attachments are written to the local private data repository first. No automatic Git fetch, pull, commit, or push is attempted. `npm run git:sync` remains available later as an explicit manual operation.

"Local-only" does **not** mean WhatsApp itself works without internet. Your laptop must be online to receive new WhatsApp messages. If connectivity disappears, the local service remains alive, reports `offline`/`reconnecting`, notifies you, and reconnects when the network returns. Unread replay after an outage remains best effort.

## Optional automatic private-repository sync

For automatic private-repository sync during the Asia/Kolkata daytime window:

```env
LOCAL_ONLY_MODE=false
GIT_SYNC_ENABLED=true
GIT_SYNC_INTERVAL_MINUTES=120
OPENWA_AUTO_RECONNECT=true
OPENWA_BACKGROUND_AUTH_MODE=existing-session-only
```

Messages and attachments are always written locally first. After each successful message save, the collector asynchronously attempts a Git sync when inside the allowed window. A scheduled check also runs every two hours, from 07:00 through 22:59 in `TIMEZONE` (`Asia/Kolkata` by default). Git errors cannot stop WhatsApp collection.

## Systemd installation and watchdog

Systemd user services are the recommended Linux background method:

```bash
npm run build
npm run systemd:install
systemctl --user enable --now placement-collector.service placement-collector-watchdog.timer
```

The installer creates four user units:

- `placement-collector.service`
- `placement-collector-failure.service`
- `placement-collector-watchdog.service`
- `placement-collector-watchdog.timer`

It backs up existing units, validates generated units when possible, and does not enable or start anything automatically.

Verify them with:

```bash
npm run systemd:status
systemctl --user list-timers placement-collector-watchdog.timer --no-pager
journalctl --user -u placement-collector.service -u placement-collector-watchdog.service -n 100 --no-pager
```

To remove them:

```bash
npm run systemd:uninstall
```

PM2 remains an alternative for users who already operate PM2, but do not run PM2 and systemd collectors simultaneously.

## Low-memory three-hour batch mode

If continuous collection consumes too much RAM, the collector can run as a scheduled local batch instead. Each batch starts the collector, waits for WhatsApp readiness (including best-effort unread replay), performs one explicit sync to the private data repository, and stops the process. The next run starts three hours later.

The normal `.env` can remain local-first:

```text
LOCAL_ONLY_MODE=true
GIT_SYNC_ENABLED=false
```

The batch script temporarily enables Git only for its explicit `npm run git:sync` child process. It does not change `.env`, and local raw files are written before syncing. If the laptop is off or WhatsApp is disconnected, messages are not guaranteed to be recovered later; unread replay is best effort.

After building and installing the units, switch from continuous mode to batch mode:

```bash
npm run build
npm run systemd:install
systemctl --user disable --now placement-collector.service placement-collector-watchdog.timer
systemctl --user enable --now placement-collector-batch.timer
systemctl --user status placement-collector-batch.timer --no-pager
```

The batch journal is available with:

```bash
journalctl --user -u placement-collector-batch.service -n 100 --no-pager
```

Batch runs also write non-sensitive lifecycle information to `runtime/last-batch.json`. A batch waits for unread replay and in-flight message processing to drain, observes a quiet period, closes the protocol connection, and only then performs the explicit Git sync.

To run one batch immediately:

```bash
systemctl --user start placement-collector-batch.service
```

Do not enable the continuous collector and batch timer together. The batch runner refuses to start when the collector is already active, preventing competing WhatsApp sessions.

## Notifications and persistent alerts

The collector/watchdog can notify on:

- service failure
- WhatsApp authentication expiry
- WhatsApp offline/disconnected state
- successful recovery
- local message-processing/storage failure
- unread replay failure
- Git sync failure
- unreachable health endpoint
- persistent not-ready state
- watchdog restart
- watchdog restart budget exhausted

Desktop delivery uses `notify-send` when available. Every attempted alert is also written to:

```text
logs/alerts.log
```

This fallback matters when the graphical notification bus is unavailable. The user journal remains another independent source of failure information.

## Health and readiness

```bash
curl -s http://127.0.0.1:3100/health
curl -s -i http://127.0.0.1:3100/ready
curl -s http://127.0.0.1:3100/status
```

`/health` is process liveness and stays HTTP 200 while the local server is alive, including offline or auth-required states. `/ready` is HTTP 200 only when WhatsApp is connected and the listener is active; otherwise it returns HTTP 503. `/status` contains expanded safe diagnostics without raw messages, IDs, phone numbers, secrets, or session details.

The watchdog uses `/health`, not GitHub or an external monitoring service, so it works on the local machine without cloud infrastructure.

## Data layout

```text
<private-data-repository>/incoming/YYYY-MM-DD/
├── messages.jsonl
├── manifest.json
├── failed-downloads.jsonl
└── attachments/
```

Attachments are downloaded locally before a message is archived, subject to `MAX_ATTACHMENT_SIZE_MB`, and recorded with checksums. Failed downloads do not discard the message. Message IDs are reconciled from the raw JSONL archive on startup so a crash between the raw write and deduplication-state update does not create duplicates after restart.

## Manual Git upload

Keep local-only mode enabled if you do not want background Git activity. When you intentionally want to upload reviewed data:

```bash
npm run git:check
npm run git:status
npm run git:sync
```

Git sync stages only `incoming/`, never uses a hard reset or force-push, and leaves local raw files untouched when the network or remote is unavailable.

## Doctor, tests, and validation

```bash
npm run doctor
npm run format:check
npm run typecheck
npm run lint
npm test
npm run build
npm run watchdog:run
npm run validate:data
```

`doctor` checks configuration, local directory usability, notification transport availability, the installed collector systemd unit, and whether the watchdog timer is installed.

For a daily archive:

```bash
TODAY=$(TZ=Asia/Kolkata date +%F)
npm run validate:day -- "$TODAY"
```

CI runs formatting, type checking, linting, tests, production build, and shell syntax checks on pull requests and `main`.

## Troubleshooting

- `auth_required`: stop the service and run `npm run auth` in a local terminal, then start the service again. Run `npm run groups:select` only if group settings need changing.
- `WhatsApp session is already in use`: stop the collector and wait for the process to exit; the shared lock prevents competing clients. Only genuinely stale locks are removed automatically.
- Permission errors: run `npm run doctor`. It reports a safe ownership command for the specific session/runtime/log/data directory; it never changes ownership automatically.
- `offline` or `reconnecting`: the local health server remains available. The collector retries with bounded exponential backoff and jitter. The watchdog deliberately does not restart normal network-offline/auth-required states.
- Health endpoint unreachable: the watchdog waits for three consecutive failed checks before restarting, avoiding restarts for tiny transient delays.
- Repeated hard failures: after three watchdog restarts without a successful ready state, automatic watchdog restarts stop and a `watchdog-gave-up` critical alert is recorded.
- Git failures: local data remains untouched. Retry `npm run git:sync` after connectivity/authentication is restored.
- Notification popup missing: inspect `logs/alerts.log` and `journalctl --user -u placement-collector.service -u placement-collector-watchdog.service`.

## Account-risk warning

Baileys is an unofficial WhatsApp Web protocol client. Even read-only use may carry account or service risk. Use a dedicated account where appropriate, follow WhatsApp terms, protect the local session directory, and never share QR codes or session files.
