#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p logs
npm run git:sync >> logs/git-sync.log 2>&1
