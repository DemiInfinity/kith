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
4. **Create an API key in that workspace.** Either paste it into the parent view (Settings › Claude), where it's
   checked with Anthropic and stored encrypted (this needs `KITH_SECRET_KEY` in `.env`: `openssl rand -hex 32`), or
   put it in `.env` as `ANTHROPIC_API_KEY`. A key saved in the parent view takes priority; only its last four
   characters are ever shown.
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
| Hard stop | $48 a month | Everything rests, leaving headroom under the $50 Console cap. "Grown-up?" still works. |

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

Kith signs in with OpenID Connect using the authorization code flow with PKCE (S256), state and nonce. It's tested
against a stand-in shaped like [Pocket ID](https://pocket-id.org).

1. **In Pocket ID, add an OIDC client** named "Kith":
   - Callback URL: `https://<your-kith-host>/auth/callback`.
   - Logout callback URL: `https://<your-kith-host>/`.
   - Make it a **public client** (PKCE, no secret). A confidential client works too; then set
     `KITH_OIDC_CLIENT_SECRET` (and `KITH_OIDC_TOKEN_AUTH` if your provider wants the secret in the form body).
   - Optional: limit the client to allowed groups in Pocket ID as well.
2. **Fill in `.env`**:
   - `KITH_PUBLIC_URL`: Kith's public address, used for redirects and secure cookies.
   - `KITH_OIDC_ISSUER`: your Pocket ID address (its `APP_URL`, e.g. `https://id.example.com`, no trailing slash).
   - `KITH_OIDC_CLIENT_ID`.
   - `KITH_PARENT_LABEL`: what the child calls you ("Mum", "Dad"…).
3. **Say who gets in.** Use one, or combine them; nobody else gets in.

   | Way | Settings | Notes |
   |---|---|---|
   | **Groups** (easiest with Pocket ID) | `KITH_OIDC_CHILD_GROUP=kith-child`, `KITH_OIDC_PARENT_GROUP=kith-parent` | Create these groups in Pocket ID. Kith then asks for the `groups` scope. |
   | **User IDs** | `KITH_CHILD_IDS` / `KITH_PARENT_IDS` | The Pocket ID user ID (the token's `sub`). |
   | **Verified emails** | `KITH_CHILD_IDS` / `KITH_PARENT_IDS` | Pocket ID only marks emails verified if `EMAILS_VERIFIED` or email verification is on. Kith ignores unverified emails unless `KITH_OIDC_TRUST_EMAIL=true`. |

   Taking someone out of the ID/email lists ends their sessions. A group sign-in lasts until the session ends (30 days
   for the child, 14 for a parent), as long as the group setting is unchanged.
4. **Signing out** of Kith also signs out of Pocket ID (RP-initiated logout).
5. **If Pocket ID uses a private CA**, give the container `NODE_EXTRA_CA_CERTS`.

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
- **Websites**: see Pip's browser below.

## 8. Pip's browser (on the desk)

The desk's browser reads web pages only for tasks the child asked for:

- It looks things up before making revision notes or flashcards.
- By default it can open **the whole web, minus a block list**. You choose what's blocked in the parent view ›
  Settings › The desk's browser:
  - **Categories** (all on by default): adult and explicit; gambling; dating; social media and stranger chat; weapons,
    drugs, gore and self-harm; proxies, VPNs and ways around filters. Each blocks known domains and host names
    containing tell-tale words (whole words only, so "alphabet" isn't caught by "bet").
  - **Your own blocked sites**, one per line (subdomains are blocked too).
  - **Public block lists** in hosts-file format, fetched once a day. The default is StevenBlack's
    [gambling + porn list](https://github.com/StevenBlack/hosts). If a download fails, the last good copy is kept.
  - **Favourite sites** (Wikipedia, BBC Bitesize, Oak and similar by default) are searched first and are never blocked
    by a public list, only by your own list.
- If you'd rather keep it to a fixed list, switch "What it can reach" to "Only the favourite sites below".
- **Robot checks stop it.** If a site puts up a CAPTCHA or an "are you human?" page, Pip stops there, logs
  "stopped: robot check", and moves on. It never tries to get past one. (A person who has taken over can do the check
  themselves.)

**How it stays locked down:**

- **The desk has no internet.** Its only way out is the `egress` container, which allows HTTPS to public hosts
  that aren't blocked (it holds the full block list, public lists included), and never to private addresses or
  internal names (your home network included).
- **A real browser, with limits.** It has tabs, JavaScript and its own saved storage (cookies, site data), kept in
  the desk's volume; "Clear saved data" in the parent view wipes it. On its own Pip only reads: it never types, sends
  anything or downloads. When a person takes over they can click, type, scroll and use tabs, but signing in is
  blocked: password fields can't be typed into, and anything sent with a password in it is refused. No downloads,
  uploads, notifications, camera, microphone or location, ever.
- **Windows** on the desk can be minimised (they wait on the taskbar), maximised or closed, like a normal desktop.
- **Search** goes through Bing with SafeSearch strict (no key needed; a cookie keeps it strict in the browser too),
  the Brave Search API with SafeSearch strict if you set `KITH_BRAVE_API_KEY`, or Wikipedia's own search.
  DuckDuckGo is offered but usually answers servers with a robot check, so Pip stops there. Blocked results are dropped and favourites come
  first.
- **What it reads is treated as information, never as instructions.** Each page passes the safety check before the
  companion uses it.
- **Every page is logged.** The child and the parent see the same live screen (watching is on by default), including
  the pointer, and every visit is in "What Pip did today".
- **Take over** sits on the desktop's bottom bar. Whoever takes over drives (same rules); everyone else watching sees
  their pointer and pages. "Give back" (or 3 minutes idle) hands it back to Pip.

To switch browsing off, untick it in the parent view.

**Sleeping:** on the desk page the screen goes black after two quiet minutes and wakes with a click. The desk's
browser shuts down too, and starts again when someone (or Pip) uses it, so an idle desk uses about 20 MB of memory
instead of about 200 MB. The desk container itself stays up, because Kith reads the desk's files from it, and starting
and stopping containers would mean giving Kith control of Docker (effectively root on the server).

**If the desk can't save (an `EACCES` error in the desk's browser):** the `desk-data` volume was created by an older
image as a different user. Give it to the desk's user once:

```bash
docker run --rm --user root -v kith_desk-data:/desk --entrypoint chown kith-desk:local -R 1001:1001 /desk
```

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

## Skills and /commands

In the parent view, **Skills** holds how-tos you write for the companion (how to help with maths, how to run a quiz,
your rules for game nights). The companion sees each skill's name and when to use it, and loads the full text (with
its `use_skill` tool) only when it's relevant. Give a skill a command (like `quiz`) and your child can type `/quiz` in
chat to use it straight away; typing `/` shows the list. Your safeguards always come first, whatever a skill says.
Three examples are ready to start from. Built-in commands are always there too: `/help`, `/usage`, `/connectors`,
`/skills`, `/reload-skills`, `/memory`, `/schedule`, `/desk`, `/new`, `/call`, `/grownup`, `/settings`. The info ones
show a card in the chat without asking the companion, so they use no energy; skills can't reuse these names. Your child can see the skills that are on under Settings › Connectors and
skills.
