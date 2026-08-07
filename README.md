# WhatsApp Placement Collector

This project is a local-first, read-only ingestion layer for selected WhatsApp placement groups. It stores new text messages and supported attachments in date-based folders using `Asia/Kolkata`, hashes chat and sender identifiers, deduplicates messages, and optionally syncs the private raw archive to a separate Git repository.

It never sends, replies to, reacts to, forwards, edits, or deletes WhatsApp messages. It does not classify companies, extract job descriptions, generate websites, or call OpenAI.

## Privacy model

Keep the code repository separate from the private raw-data repository. Never use a public repository for raw placement data. `.env`, `.local-session/`, runtime state, logs, and raw data are ignored by the code repository. The collector never logs phone numbers, raw WhatsApp IDs, QR data, message contents, tokens, or session payloads.

WhatsApp needs an internet connection to deliver messages. Local storage continues to work without GitHub. GitHub sync is optional and can be performed later. Unread replay is best effort; messages received while the laptop was fully offline are not guaranteed to be recoverable.

## Requirements

Linux, Node.js 20+, Git, and the configured Chrome for Testing/Chromium executable. A graphical desktop session is required for `npm run auth`. Use a private raw-data Git repository if manual sync is enabled.

## Installation

```bash
git clone https://github.com/puneetdixit200/openwa.git
cd openwa
npm install
```

Create `.env` from `.env.example` with `npm run setup`, or use the existing local configuration. Never commit `.env`.

## First authentication and group selection

The background service must not own the session during interactive commands:

```bash
systemctl --user stop placement-collector
cd /home/pd/openwa
npm run auth
npm run groups:select
```

`npm run auth` opens a visible browser only for interactive authentication. Scan the QR locally when WhatsApp asks for it. The command does not send messages or select groups. `groups:select` uses `getAllGroups(false)`, prints names only, accepts comma-separated indexes, asks for confirmation, and stores exact IDs without displaying them. For example, select `1,2` at the prompt.

The collector uses `OPENWA_BACKGROUND_AUTH_MODE=existing-session-only` and `OPENWA_HEADLESS=true` in the background. If authentication expires, it reports `auth_required` and tells you to run `npm run auth`; it does not repeatedly open visible browsers or delete the session.

## Local-first operation

For automatic private-repository sync every two hours during the Asia/Kolkata daytime window:

```env
LOCAL_ONLY_MODE=false
GIT_SYNC_ENABLED=true
GIT_SYNC_INTERVAL_MINUTES=120
OPENWA_AUTO_RECONNECT=true
OPENWA_BACKGROUND_AUTH_MODE=existing-session-only
```

Messages and attachments are always written to the private local data repository first. Automatic Git sync checks run every two hours, but only from 07:00 through 22:59 in `TIMEZONE` (`Asia/Kolkata` by default). The 23:00–06:59 period is intentionally skipped. Git errors cannot stop WhatsApp collection.

The user service sends a desktop notification when it starts and a critical notification if systemd marks it failed. Detailed diagnostics remain in the user journal; notifications never include message, group, account, or secret data.

For fully local-only operation, set `LOCAL_ONLY_MODE=true` and `GIT_SYNC_ENABLED=false`; `npm run git:sync` remains available as an explicit manual operation later.

## Verification and operation

```bash
npm run doctor
npm run build
npm run systemd:install
systemctl --user enable --now placement-collector

curl -s http://127.0.0.1:3100/health
curl -s -i http://127.0.0.1:3100/ready
systemctl --user status placement-collector --no-pager
journalctl --user -u placement-collector -n 100 --no-pager
```

`/health` is a process-liveness endpoint and returns HTTP 200 while the local server is running, including offline or auth-required states. `/ready` returns HTTP 200 only when WhatsApp is connected and the listener is active; otherwise it returns HTTP 503. `/status` provides expanded safe diagnostics without raw messages, IDs, phone numbers, secrets, or session details.

## Data layout

```text
<private-data-repository>/incoming/YYYY-MM-DD/
├── messages.jsonl
├── manifest.json
├── failed-downloads.jsonl
└── attachments/
```

Attachments are downloaded locally before a message is archived, subject to `MAX_ATTACHMENT_SIZE_MB`, and recorded with checksums. Failed downloads do not discard the message.

## Manual Git upload

Keep local-only mode enabled during live testing. After reviewing the private repository:

```bash
npm run git:check
npm run git:status
npm run git:sync
```

Git sync stages only `incoming/`, never uses a hard reset or force-push, and leaves local raw files untouched when the network or remote is unavailable.

## Systemd and PM2

Systemd user services are the recommended Linux background method:

```bash
npm run systemd:install
systemctl --user enable --now placement-collector
npm run systemd:status
npm run systemd:logs
```

The installer backs up an existing unit, validates the generated unit when possible, and does not enable or start it automatically. It rejects root execution. To remove it:

```bash
npm run systemd:uninstall
```

PM2 remains an alternative for users who already operate PM2, but do not run PM2 and systemd collectors simultaneously.

## Health, tests, and validation

```bash
npm run format:check
npm run typecheck
npm run lint
npm test
npm run build
npm run validate:data
```

For a daily archive:

```bash
TODAY=$(TZ=Asia/Kolkata date +%F)
npm run validate:day -- "$TODAY"
```

## Troubleshooting

- `auth_required`: stop the service and run `npm run auth` in a graphical desktop session, then run `npm run groups:select` if group settings need changing.
- `OpenWA session is already in use`: stop the collector and wait for the process to exit; the shared lock prevents competing browsers. Only genuinely stale locks are removed automatically.
- Browser launch or permission errors: run `npm run doctor`. It reports a safe ownership command for the specific session/runtime/log/data directory; it never changes ownership automatically.
- `offline` or `reconnecting`: the local health server remains available. The collector retries with bounded exponential backoff and jitter when enabled.
- Git failures: keep collecting locally and retry `npm run git:sync` after connectivity/authentication is restored.

## Account-risk warning

OpenWA is an unofficial WhatsApp automation client. Even read-only use may carry account or service risk. Use a dedicated account where appropriate, follow WhatsApp terms, protect the local session directory, and never share QR codes or session files.
