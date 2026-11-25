# Setting up Kith

Everything is configured in `.env` (copy `.env.example`). Nothing family-specific lives in the code.

## 1. Anthropic: your own key, on an organisation, with a spend limit

Kith calls Claude through the Claude API from the server only. The key never reaches the phone.

1. **Use an API organisation under Anthropic's Commercial Terms.**
   - In the [Anthropic Console](https://console.anthropic.com), check which terms your organisation accepted, under
     Settings › Organization.
   - Anthropic's Consumer Terms don't allow under-18s, or making your account available to anyone else. See
     [minors-policy.md](minors-policy.md).
2. **Make a workspace just for Kith**, for example "Kith". Spending and keys stay separate from everything else.
3. **Set the workspace's monthly spend limit** under Console › Settings › Limits (workspace limits).
   - This is the cap that really protects you. A good starting point is $50 a month.
   - Kith's own monthly figure is only a backstop.
4. **Create an API key in that workspace** and put it in `.env` as `ANTHROPIC_API_KEY`.
5. **Check data settings**: API inputs and outputs aren't used for training under the Commercial Terms.

Kith's own limits, enforced on the server and changeable in the parent view. The defaults are designed for heavy,
everyday use inside a $50 Console cap:

| Setting | Default | What happens |
|---|---|---|
| Each week | $11.50, tops up Monday 00:00 | Spreads the month evenly. Split between chat and the desk with the parent's slider. |
| Desk share | 15% | The desk and Studio get a **daily slice** of the week (~$0.25 a day). Unused days roll forward within the week. It can never eat into chat. |
| Full power per window | $2.50 per 5 hours | Spreads Full power through the week. |
| Rollover | up to +$2.50 per window | Unused Full power from quieter windows earlier in the week tops later windows up. |
| Low power | below 15% energy | Switches smoothly to Claude Haiku 5.5 and says so in a friendly way ("I'm in low-power mode until 6pm"). It **keeps going**. |
| Hard stop | $48 a month | Everything rests, leaving headroom under the $50 Console cap. "Need a grown-up?" still works. |

**Which model does what:**

| Model | Used for |
|---|---|
| Claude Sonnet 5.5 (Full power) | Live chat, calls, story co-writing and Studio builds (games, stories, comics) |
| Claude Haiku 5.5 | The safety check, rolling summaries, check-ins, the journal and weekly summary, flashcards, practice questions and revision help |

**Keeping each turn small:**

- The system prompt (safety rules, personality) and the memory block are prompt-cached at the front of every request.
- Older conversation is folded into a short rolling summary, so each turn's input stays around 10–15k tokens.

**Rough costs:**

- A chat turn on Sonnet with caching: about $0.01.
- A 30-minute call: about $1.50–2.
- A Studio game build: $0.10–0.30.

The parent view shows spending this week and month, a projection for the month, and how often Low power was used.

Every call is costed from the API's reported usage, safety checks included. Prices are in
`server/src/budget/pricing.ts`; update them if Anthropic's prices change.

## 2. Sign-in (Pocket ID or any OpenID Connect provider)

1. **In Pocket ID, add an OIDC client** named "Kith":
   - Callback URL: `https://<your-kith-host>/auth/callback`.
   - Turn PKCE on. With PKCE you can leave the client secret empty (a public client).
2. **Fill in `.env`**:
   - `KITH_PUBLIC_URL`: Kith's public address, used for redirects and secure cookies.
   - `KITH_OIDC_ISSUER`: e.g. `https://auth.example.com`.
   - `KITH_OIDC_CLIENT_ID`, plus `KITH_OIDC_CLIENT_SECRET` if the client isn't public.
   - `KITH_CHILD_IDS` and `KITH_PARENT_IDS`: comma-separated **verified** emails, or OIDC subject ids. Nobody else gets
     in. Taking someone out of the list ends their sessions.
   - `KITH_PARENT_LABEL`: what the child calls you ("Mum", "Dad"…).
3. **If your identity provider uses a private CA**, give the container `NODE_EXTRA_CA_CERTS`.

`KITH_DEV_LOGIN=true` adds "Try as the child / parent" buttons with no sign-in. Use it only on your own machine.

## 3. Secrets you generate

```bash
openssl rand -hex 32     # KITH_DESK_TOKEN (shared by the server and the desk)
npm run vapid            # KITH_VAPID_PUBLIC_KEY / KITH_VAPID_PRIVATE_KEY (check-in notifications)
```

## 4. Voice (local)

`docker compose --profile voice up -d` starts two containers on the Wyoming protocol, the same one Home Assistant uses:

- `whisper` (faster-whisper) for speech-to-text.
- `piper` for text-to-speech.

On first start they download their models. After that, speech never leaves the house and audio isn't stored.

- **Already run Piper?** Skip the `voice` profile's piper and set `KITH_TTS_HOST` and `KITH_TTS_PORT` to it. Same for
  whisper with `KITH_STT_HOST` and `KITH_STT_PORT`.
- **The three voices** on the Personality screen come from `KITH_VOICES` (`Label=piper-voice`). wyoming-piper downloads
  a named voice the first time it's asked for. Browse voices at https://rhasspy.github.io/piper-samples/.
- **Accuracy vs speed:** `KITH_WHISPER_MODEL` trades the two (`tiny-int8` is quick; `base-int8` or `small-int8` are
  more accurate).

## 5. Reports to the grown-up

`KITH_REPORTERS` is a comma-separated list:

- `console`: logs reports (the default; good for testing).
- `ha-board`: calls a Home Assistant script (default `script.ai_board_post`) with `{kind, handle, message}`.

**Setting up `ha-board`:**

1. **Make a Home Assistant user just for Kith** (not an admin) and create a long-lived token for it. Revoking it later
   affects nothing else.
2. **Set the variables**: `KITH_HA_URL`, `KITH_HA_TOKEN`, `KITH_HA_SERVICE` and `KITH_HA_HANDLE`.
3. **Set the three kinds**: `KITH_HA_KIND_NOW`, `KITH_HA_KIND_TODAY` and `KITH_HA_KIND_FYI`. Set them to whatever your
   board script expects. Have the "now" kind notify your phone.
4. **Test it**: in the parent view, "Send a test report" checks the whole path.

Reports that fail are retried every few minutes for a week.

**Adding a reporter** (email, Matrix, ntfy…): implement `Reporter` in `server/src/reporting/reporter.ts`, then add it to
`makeReporters`.

## 6. Check-ins (web push)

- **Keys:** set the VAPID keys from step 3.
- **On the phone:** open Kith, add it to the Home Screen (iPhone: Share › Add to Home Screen), open it from there, then
  go to "What … remembers" › "Let check-ins reach this phone".
- **Limits:**
  - At most two a day.
  - Never in quiet hours (default 22:00–07:00, set in the parent view).
  - At least three hours apart.
  - Never while the child is mid-conversation.

## 7. Connections (parent-approved, all off by default)

Set these up in the parent view › Settings › Connections. Tokens go in `.env` under the variable name shown there (for
example `KITH_CONN_HA_TOKEN`); the parent view never stores them.

- **Bedroom lights (Home Assistant)**:
  - URL `http://homeassistant.local:8123`.
  - List only the child's room entities, e.g. `light.bedroom`.
  - Use a token from a separate, non-admin HA user.
  - Kith uses HA's REST API rather than its MCP server, because the MCP server exposes everything exposed to Assist and
    can't be narrowed to one room.
- **Kin**:
  - The MCP endpoint URL and its token.
  - List the tools to allow, e.g. `get_today, list_events, list_chores, list_reminders`. Add `add_reminder` and set
    "can act" if the child may add their own reminders.
- **Jellyfin**:
  - The URL and an API key.
  - "Can act" plus a user id lets the companion make playlists.
- **Calculator / dictionary**: homework helpers.
- **Allowed websites**: only the sites you list, https only, e.g. `bbc.co.uk/bitesize`.

## 8. Pip's browser (on the desk)

The desk's browser reads web pages only for tasks the child asked for:

- It looks things up before making revision notes or flashcards.
- It only opens sites on the family safe list. Edit the list in the parent view › Settings › Pip's browser.
- The defaults are education sites: Wikipedia, BBC Bitesize, Oak National Academy and similar.

**How it stays locked down:**

- **The desk has no internet.** Its only way out is the `egress` container, which allows HTTPS to safe-listed hosts
  only and never to private addresses (your home network included).
- **Read-only:** the browser runs with JavaScript off, and with no downloads, uploads, forms, sign-ins or cookies.
- **Search** goes through Wikipedia's own search, or the Brave Search API with SafeSearch strict if you set
  `KITH_BRAVE_API_KEY`. Only safe-listed results are used.
- **What it reads is treated as information, never as instructions.** Each page passes the safety check before the
  companion uses it.
- **Every page is logged.** The child and the parent can watch live and see every visit in "What Pip did today".

To switch browsing off, untick it in the parent view.

## 9. Running it

```bash
docker compose --profile voice up -d --build
docker compose logs -f kith
```

- **Reverse proxy (e.g. ai.example.com):**
  - Set `KITH_BIND=0.0.0.0` (or keep 127.0.0.1 if the proxy is on the same host).
  - Proxy to port 8787, and set `KITH_PUBLIC_URL` to the https address.
  - Microphone access needs https.
- **Data** lives in two volumes:
  - `kith-data`: the SQLite database.
  - `desk-data`: everything on the desk.
  - Back up both.
- **Upgrades:** `git pull && docker compose up -d --build`.
