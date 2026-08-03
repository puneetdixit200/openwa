# WhatsApp Placement Collector

A local Node.js 20+ / TypeScript collector for preserving messages from explicitly allowlisted WhatsApp placement groups. It uses OpenWA 4.76, stores an append-oriented filesystem archive, hashes sender and chat identifiers, downloads media with size limits, exposes only local health endpoints, and optionally syncs `incoming/` to a private Git remote.

It does not classify messages, send replies, scrape full history, or expose WhatsApp automation to the network. Offline recovery depends on WhatsApp Web synchronisation and is not guaranteed.

## Install

```bash
git clone https://github.com/puneetdixit200/openwa.git
cd openwa
npm install
cp .env.example .env
```

Edit `.env`. `HASH_SALT` and at least one exact `ALLOWED_GROUP_IDS` or `ALLOWED_GROUP_NAMES` are required. IDs take precedence; names are useful for initial discovery. Use SSH for the private remote where possible:

```bash
git remote set-url origin git@github.com:USERNAME/PRIVATE_REPOSITORY.git
```

## Run

First authentication opens WhatsApp Web and prints/shows a QR code. Scan it once; `.local-session/` is reused and never committed.

```bash
npm run dev
npm run groups:list       # after authentication: masked IDs and allow status
npm run build && npm start
```

PM2:

```bash
npm run build
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
pm2 status
pm2 logs placement-collector
```

Git sync can run internally every `GIT_SYNC_INTERVAL_MINUTES` or externally:

```bash
npm run git:sync
*/15 * * * * /absolute/path/openwa/scripts/git-sync.sh
```

Only `incoming/` is staged. The sync uses a lock, fetches and rebases safely, never force-pushes or resets, and aborts on conflicts. Git credentials belong in SSH/Git's credential manager, never in source or `.env`.

## Configuration

`TIMEZONE` controls daily folders (default `Asia/Kolkata`). `OPENWA_SESSION_ID` and `OPENWA_HEADLESS` control OpenWA. `ALLOWED_GROUP_IDS` and `ALLOWED_GROUP_NAMES` define the exact allowlist. `DATA_DIRECTORY`, `RUNTIME_DIRECTORY`, and `LOG_DIRECTORY` define local storage. `HASH_SALT` is required for salted SHA-256 privacy hashes. `DOWNLOAD_ATTACHMENTS` and `MAX_ATTACHMENT_SIZE_MB` control media. `GIT_*` controls branch, remote, author, and schedule. `HEALTH_SERVER_*` controls the loopback-only Express server. `MESSAGE_TEXT_PRIVACY_MODE=preserve` keeps placement text unchanged; `redact-phone-numbers` redacts phone-like text. `PRESERVE_DISPLAY_NAMES=false` removes display names. `EMIT_UNREAD_MESSAGES_ON_START` requests OpenWA unread emission. `LOG_LEVEL` controls Pino verbosity.

Health is local at `http://127.0.0.1:3100/health` and `/status`; responses exclude message contents, phone numbers, raw IDs, salt, and credentials.

## Data format

Each accepted message is one JSON object in `incoming/YYYY-MM-DD/messages.jsonl`; group and sender identifiers are salted hashes. Attachments are stored under that day's `attachments/` directory with safe names and SHA-256 checksums. `manifest.json` summarizes counts and timestamps. Failed media remains represented in the message and is appended to `failed-downloads.jsonl`. `runtime/` contains deduplication state and locks; it is intentionally ignored by Git.

## Validation and troubleshooting

```bash
npm run typecheck && npm run lint && npm test && npm run build
npm run validate:day -- 2026-08-04
npm run status
```

Repeated QR requests usually mean an expired local session; stop the process and inspect `.local-session/` before re-authenticating. If Chrome is unavailable, install Chromium and check OpenWA's launch output. For a disconnected account, reconnect WhatsApp Web and restart the process. Attachment failures are bounded and recorded. Git failures are logged in `logs/git-sync.log`; resolve remote conflicts manually. If a manifest is damaged, preserve `messages.jsonl` and reconstruct it only through an explicit repair workflow.

The collector is intentionally read-only with respect to WhatsApp. OpenWA is unofficial automation software and may break when WhatsApp Web changes.
