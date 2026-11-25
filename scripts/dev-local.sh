#!/usr/bin/env bash
# Runs Kith locally without Docker, for trying the app: the desk on :8790 and the server on :8787
# with dev sign-in on. Data goes to ./data-dev. No API key is needed (the companion says it isn't
# switched on yet); set ANTHROPIC_API_KEY in your shell to try it for real.
set -euo pipefail
cd "$(dirname "$0")/.."
DATA="${KITH_DEV_DATA:-$PWD/data-dev}"
mkdir -p "$DATA"
npm run build >/dev/null
export KITH_DESK_TOKEN="${KITH_DESK_TOKEN:-dev-desk-token}"
(cd desk && DESK_DIR="$DATA/desk" node dist/index.js) &
DESK=$!
trap 'kill $DESK 2>/dev/null' EXIT
cd server
KITH_DESK_URL=http://localhost:8790 KITH_DATA_DIR="$DATA" KITH_DEV_LOGIN=true \
KITH_STT_HOST="${KITH_STT_HOST:-localhost}" KITH_TTS_HOST="${KITH_TTS_HOST:-localhost}" \
  node --disable-warning=ExperimentalWarning dist/index.js
