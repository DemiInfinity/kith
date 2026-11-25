#!/usr/bin/env bash
# Kith: put secrets into .env safely, from a terminal.
#
#   ./scripts/setup-secrets.sh          # walk through everything (Enter keeps what's already set)
#   ./scripts/setup-secrets.sh --check  # only show what's set and what's missing (never the values)
#
# - Secrets are typed with hidden input and never printed, logged or passed on a command line.
# - Generated secrets (KITH_SECRET_KEY, KITH_DESK_TOKEN, VAPID keys) are made here and never shown.
#   Existing ones are never replaced: changing KITH_SECRET_KEY would lock away anything already stored encrypted.
# - .env is written with permissions 600 (only you can read it).
# Run it from the Kith folder (the one with docker-compose.yml), on the machine that runs Kith.
set -euo pipefail
umask 077

cd "$(dirname "$0")/.."
ENV_FILE=.env
CHECK_ONLY=false
[ "${1:-}" = "--check" ] && CHECK_ONLY=true

if [ ! -f docker-compose.yml ]; then echo "Run this from the Kith folder." >&2; exit 1; fi
if [ ! -f "$ENV_FILE" ]; then
  if $CHECK_ONLY; then echo "No .env yet. Run without --check to create it." >&2; exit 1; fi
  cp .env.example "$ENV_FILE"
  echo "Made .env from .env.example."
fi
chmod 600 "$ENV_FILE"

bold=$(printf '\033[1m'); dim=$(printf '\033[2m'); green=$(printf '\033[32m'); amber=$(printf '\033[33m'); off=$(printf '\033[0m')

# Read a value from .env (last one wins), without printing it.
get() { awk -v k="$1" 'index($0, k"=") == 1 { v = substr($0, length(k) + 2) } END { print v }' "$ENV_FILE"; }

# Set KEY to a value in .env. The value travels through the environment, never through argv.
put() {
  local key="$1"
  local tmp
  tmp=$(mktemp "${ENV_FILE}.XXXXXX")
  KITH_PUT_VALUE="$2" awk -v k="$key" '
    BEGIN { v = ENVIRON["KITH_PUT_VALUE"]; done = 0 }
    index($0, k"=") == 1 { if (!done) { print k "=" v; done = 1 }; next }
    { print }
    END { if (!done) print k "=" v }' "$ENV_FILE" > "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$ENV_FILE"
}

is_set() { [ -n "$(get "$1")" ]; }
tick() { if is_set "$1"; then printf '  %s✓%s %s\n' "$green" "$off" "$1"; else printf '  %s–%s %s %s%s%s\n' "$amber" "$off" "$1" "$dim" "${2:-}" "$off"; fi; }

# Visible prompt for a non-secret setting. Enter keeps the current value.
ask() {
  local key="$1" label="$2" cur reply
  cur=$(get "$key")
  read -r -p "  $label [${cur:-empty}]: " reply || true
  if [ -n "$reply" ]; then put "$key" "$reply"; fi
}

# Hidden prompt for a secret. Enter keeps the current one; "-" clears it.
secret() {
  local key="$1" label="$2" state reply
  if is_set "$key"; then state="set, Enter keeps it, - clears it"; else state="not set, Enter skips"; fi
  read -r -s -p "  $label ($state): " reply || true
  echo
  if [ "$reply" = "-" ]; then put "$key" ""; echo "    cleared"; return; fi
  if [ -n "$reply" ]; then
    put "$key" "$reply"
    echo "    saved (${#reply} characters)"
  fi
}

gen_hex() { openssl rand -hex 32; }

summary() {
  echo
  echo "${bold}What's set${off} ${dim}(values are never shown)${off}"
  tick KITH_PUBLIC_URL
  tick KITH_SECRET_KEY "generate: run this script"
  tick KITH_DESK_TOKEN "generate: run this script"
  tick KITH_VAPID_PUBLIC_KEY "check-in notifications"
  tick KITH_VAPID_PRIVATE_KEY "check-in notifications"
  tick ANTHROPIC_API_KEY "fine if you'll paste it in the parent view instead"
  tick KITH_OIDC_ISSUER "needed to sign in"
  tick KITH_OIDC_CLIENT_ID "needed to sign in"
  tick KITH_OIDC_CLIENT_SECRET "only for a confidential client"
  tick KITH_GOOGLE_CLIENT_ID "optional: Google Drive"
  tick KITH_GOOGLE_CLIENT_SECRET "optional: Google Drive"
  tick KITH_BRAVE_API_KEY "optional: web search for the desk"
  tick KITH_HA_TOKEN "optional: reports to Home Assistant"
  if [ "$(get KITH_DEV_LOGIN)" = "true" ]; then
    echo "  ${amber}! KITH_DEV_LOGIN is true: anyone can get in without signing in. Set it to false on a real server.${off}"
  fi
  local perms
  perms=$(stat -c %a "$ENV_FILE" 2>/dev/null || stat -f %Lp "$ENV_FILE")
  if [ "$perms" = "600" ]; then echo "  ${green}✓${off} .env can only be read by you"; else echo "  ${amber}! .env permissions are $perms (expected 600)${off}"; fi
}

if $CHECK_ONLY; then summary; exit 0; fi

echo
echo "${bold}Kith secrets setup${off}"
echo "${dim}Secrets are typed hidden and never shown. Press Enter to keep what's already there.${off}"

# ── 1. Generated secrets ──────────────────────────────────────────────────────────────
echo
echo "${bold}1. Secrets Kith makes itself${off}"
for key in KITH_SECRET_KEY KITH_DESK_TOKEN; do
  if is_set "$key"; then echo "  ✓ $key already set (kept)"; else put "$key" "$(gen_hex)"; echo "  ✓ $key generated"; fi
done
if is_set KITH_VAPID_PUBLIC_KEY && is_set KITH_VAPID_PRIVATE_KEY; then
  echo "  ✓ VAPID keys already set (kept)"
else
  vapid=""
  if docker image inspect kith:local >/dev/null 2>&1; then
    vapid=$(docker run --rm --network none --entrypoint node kith:local -e '
      const w = require("web-push"); const k = w.generateVAPIDKeys();
      process.stdout.write(k.publicKey + " " + k.privateKey);' 2>/dev/null || true)
  elif command -v node >/dev/null 2>&1 && [ -d node_modules/web-push ]; then
    vapid=$(node -e 'const k=require("web-push").generateVAPIDKeys();process.stdout.write(k.publicKey+" "+k.privateKey)')
  fi
  if [ -n "$vapid" ]; then
    put KITH_VAPID_PUBLIC_KEY "${vapid%% *}"
    put KITH_VAPID_PRIVATE_KEY "${vapid#* }"
    echo "  ✓ VAPID keys generated"
  else
    echo "  ${amber}– Couldn't make VAPID keys yet (build the image first: docker compose build). Run this again after.${off}"
  fi
  unset vapid
fi

# ── 2. Where Kith lives and who signs in ──────────────────────────────────────────────
echo
echo "${bold}2. Address and sign-in${off} ${dim}(not secret, shown as you type)${off}"
ask KITH_PUBLIC_URL "Kith's address, e.g. https://kith.example.com"
ask KITH_OIDC_ISSUER "Sign-in provider (Pocket ID address)"
ask KITH_OIDC_CLIENT_ID "Client ID from the provider's Kith client"
ask KITH_OIDC_CHILD_GROUP "Group for the child"
ask KITH_OIDC_PARENT_GROUP "Group for the grown-up"
ask KITH_PARENT_LABEL "What the child calls you"
secret KITH_OIDC_CLIENT_SECRET "Client secret (leave empty for a public client)"
if [ "$(get KITH_DEV_LOGIN)" = "true" ]; then
  read -r -p "  KITH_DEV_LOGIN is on (no sign-in needed). Turn it off? [Y/n]: " r || true
  case "$r" in n|N) ;; *) put KITH_DEV_LOGIN false; echo "    turned off";; esac
fi

# ── 3. Claude ────────────────────────────────────────────────────────────────────────
echo
echo "${bold}3. Claude API key${off}"
echo "${dim}  Use a key from the workspace you made for Kith (with its own monthly limit).${off}"
echo "${dim}  Or press Enter and paste it later in the parent view (Settings › Claude), where it's stored encrypted.${off}"
secret ANTHROPIC_API_KEY "API key"
if is_set ANTHROPIC_API_KEY && command -v curl >/dev/null 2>&1; then
  printf '  Checking it with Anthropic… '
  # The key goes to curl on stdin (-K -), so it never appears in the process list.
  code=$(printf 'header = "x-api-key: %s"\nheader = "anthropic-version: 2023-06-01"\n' "$(get ANTHROPIC_API_KEY)" |
    curl -s -o /dev/null -w '%{http_code}' -K - https://api.anthropic.com/v1/models || echo 000)
  case "$code" in
    200) echo "${green}works${off}";;
    401|403) echo "${amber}Anthropic didn't accept it (HTTP $code). Check you copied the whole key.${off}";;
    *) echo "${amber}couldn't check (HTTP $code). It's saved; try again later.${off}";;
  esac
fi

# ── 4. Optional extras ───────────────────────────────────────────────────────────────
echo
echo "${bold}4. Optional extras${off} ${dim}(Enter skips each one)${off}"
read -r -p "  Set up Google Drive now? [y/N]: " r || true
case "$r" in y|Y)
  ask KITH_GOOGLE_CLIENT_ID "Google OAuth client ID"
  secret KITH_GOOGLE_CLIENT_SECRET "Google OAuth client secret"
  ask KITH_GOOGLE_ACCOUNT "The only Google account allowed (optional)";;
esac
read -r -p "  Add a Brave Search key for the desk browser? [y/N]: " r || true
case "$r" in y|Y) secret KITH_BRAVE_API_KEY "Brave Search API key";; esac
read -r -p "  Send reports to Home Assistant? [y/N]: " r || true
case "$r" in y|Y)
  ask KITH_HA_URL "Home Assistant address"
  secret KITH_HA_TOKEN "Long-lived token for Kith's own HA user"
  if is_set KITH_HA_TOKEN; then
    reps=$(get KITH_REPORTERS)
    case ",$reps," in *,ha-board,*) ;; *) put KITH_REPORTERS "${reps:+$reps,}ha-board";; esac
  fi;;
esac

summary
echo
echo "Next: ${bold}docker compose --profile voice up -d${off} (or without --profile voice for no calls)."
