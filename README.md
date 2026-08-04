# WhatsApp Placement Collector

Local, read-only ingestion for explicitly selected WhatsApp placement groups. It uses OpenWA 4.76.0, stores `Asia/Kolkata` daily archives, hashes sender/chat identifiers, prevents duplicates, and can push raw files to a separate private Git repository.

It does not classify jobs, extract JDs, call OpenAI, send replies, message group members, or scrape complete history. OpenWA is unofficial automation software; session expiry, WhatsApp Web changes, and messages received while the laptop is off can interrupt or limit collection.

## Privacy model

Keep this public code checkout separate from raw data:

```text
~/projects/openwa/       code, .env, session, runtime, logs
~/placement-data/        private Git checkout with incoming/YYYY-MM-DD/
```

Never use a public repository for raw placement data. Sender and chat identifiers are salted SHA-256 prefixes. Message text is preserved by default because phone numbers can be legitimate placement content; use `MESSAGE_TEXT_PRIVACY_MODE=redact-phone-numbers` for redaction. GitHub credentials belong in SSH/Git's credential manager, never in source or `.env`.

## Requirements and first setup

Linux, Node.js 20+, Git, Chrome/Chromium, a WhatsApp account, and a private GitHub repository for raw data. PM2 and `gh` are optional.

```bash
git clone https://github.com/puneetdixit200/openwa.git
cd openwa
npm install
npm run data-repo:init
npm run setup
npm run groups:select
npm run doctor
npm run dev
```

`data-repo:init` asks for an absolute data path, initializes it if necessary, creates `incoming/`, and writes both data paths into `.env`. It does not pretend to verify GitHub privacy. If `gh` is unavailable, create the private repository manually:

```bash
gh repo create placement-raw-data --private
git -C /home/pd/placement-data remote add origin git@github.com:USERNAME/placement-raw-data.git
```

`setup` checks Node, Git, Chrome, and the code checkout; creates `.env` only when absent; generates a cryptographically random 32-byte salt; and uses mode `600`. It never overwrites an existing `.env` silently.

## WhatsApp authentication and groups

Use `OPENWA_HEADLESS=false` for first QR authentication. Scan once; the configured session directory is reused. After authentication, `OPENWA_HEADLESS=true` may be used for background operation. Session files are never committed.

```bash
npm run groups:list
npm run groups:list -- --show-full-ids   # warning and YES confirmation required
npm run groups:select
```

Selection writes exact IDs to `.env` and never sends a WhatsApp message. When `ALLOWED_GROUP_IDS` has entries, only exact IDs are accepted. Names are used only when the ID list is empty. Direct messages, own messages, notifications, and other groups are ignored.

## Configuration

`.env.example` documents all settings. `DATA_REPOSITORY_PATH` must be a separate Git checkout and `DATA_DIRECTORY` must be inside it. `HASH_SALT` must be at least 32 characters. `GIT_SYNC_ENABLED` is false by default; enable it only after `npm run git:check` passes. Runtime state and logs remain in the code checkout and are ignored.

## Daily data

```text
<DATA_REPOSITORY_PATH>/incoming/YYYY-MM-DD/
  messages.jsonl
  manifest.json
  failed-downloads.jsonl
  attachments/
```

Each JSONL line is schema-validated. Raw WhatsApp message IDs are retained only for deduplication. Attachments use safe names, size limits, checksums, atomic writes, collision suffixes, and three bounded attempts. A failed download does not discard its message. `repair:manifest -- YYYY-MM-DD` backs up and rebuilds only the manifest.

## Safe live test and Git operations

After QR authentication, send one harmless test message from an allowed group:

```bash
TODAY=$(TZ=Asia/Kolkata date +%F)
npm run validate:day -- "$TODAY"
npm run status
npm run git:check
npm run git:status
npm run git:sync
```

Git commands run only inside `DATA_REPOSITORY_PATH`, stage only `incoming/`, reject forbidden staged files, use a lock, rebase safely, never reset or force-push, and push only the configured branch. `git:check` performs no upload.

Loopback diagnostics:

```bash
curl http://127.0.0.1:3100/health
curl http://127.0.0.1:3100/status
npm run doctor
```

The endpoints contain no message text, raw IDs, phone numbers, sender names, secrets, or session details.

## PM2 and validation

```bash
npm run build
npm run service:start
pm2 save
pm2 startup
npm run service:status
npm run service:logs
```

Available checks:

```bash
npm run format:check
npm run typecheck
npm run lint
npm test
npm run build
npm run validate:data
```

If QR authentication repeats, stop the process and inspect the session directory; it is not deleted automatically. If Chrome is missing, install Chromium/Chrome. For Git problems, run `npm run git:check` and inspect the private checkout's remote, branch, and SSH authentication. Back up the private data repository independently. Do not claim the collector is live until the user has scanned the QR code and observed one real test message.
