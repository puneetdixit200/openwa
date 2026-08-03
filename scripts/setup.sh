#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p incoming runtime/locks logs
[[ -f .env ]] || cp .env.example .env
npm install
npm run build
echo "Edit .env, then run npm run dev or pm2 start ecosystem.config.cjs"
