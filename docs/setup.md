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
   - `KITH_PUBLIC_URL`: Kith's public address, used for redirects and secure cookies (and the addresses
     the public pages and sitemap point at, if you turn those on).
   - `KITH_PUBLIC_SITE`: leave it `false` (the default). Your Kith is then just the app: "/" is its own
     sign-in, `/parents`, `/terms`, `/privacy` and `/setup` are still there for your family to read but
     every response is marked `noindex`, and `robots.txt` is `User-agent: *` / `Disallow: /`, so search
     engines and AI crawlers are asked to stay away. Set it to `true` only if you want this address to be a
     public website about Kith: the welcome page at "/" for visitors, those pages indexable, and a sitemap.
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
- **Accuracy vs speed:** `KITH_WHISPER_MODEL` trades the two. `base-int8` (the default) is accurate and keeps up on an
  old Mac mini (about 4.5 s for 10 s of speech); `tiny-int8` is quicker but mishears a lot; `small-int8` is the most
  accurate but too slow for calls on older machines. `KITH_WHISPER_PROMPT` (default "Hey Pip,") helps it spell your
  companion's name: change it if you rename them.

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
  - Turn on WebSocket support in the proxy (in Nginx Proxy Manager: "Websockets support"). Calls and live updates
    use it.
  - **A friendly page while Kith is down.** When Kith is restarting or stopped, the proxy can show "Kith is having a
    nap" (with Pip asleep) instead of its own "502 Bad Gateway". The page is one self-contained file with nothing
    else to load: `client/public/errors/kith-down.html` (also in the built client as `errors/kith-down.html`).
    1. Copy it somewhere Nginx Proxy Manager can read. NPM keeps its files under `/data` inside its container, so:

       ```bash
       docker exec <npm-container> mkdir -p /data/kith-errors
       docker cp client/public/errors/kith-down.html <npm-container>:/data/kith-errors/kith-down.html
       ```

       (Or put it in the folder you mount as NPM's `/data`, under `kith-errors/`.)
    2. In NPM, edit Kith's proxy host › **Advanced** › Custom Nginx Configuration, and paste:

       ```nginx
       # Kith is down or restarting: show the nap page instead of Nginx's own error.
       error_page 502 503 504 /kith-down.html;
       location = /kith-down.html {
           root /data/kith-errors;
           internal;
           add_header Cache-Control "no-store" always;
           add_header X-Robots-Tag "noindex, nofollow" always;
       }
       ```

    This covers the errors Nginx makes itself when it can't reach Kith (502 and 504). Leave `proxy_intercept_errors`
    off: with it on, Nginx would also swap Kith's own answers for this page, including the JSON 503s the app uses
    (for example "the safety check can't run right now"), and the app would show the wrong thing. Kith serves its
    own friendly 404, 403 and 500 pages when it's running.
- **Data** lives in two volumes:
  - `kith-data`: the SQLite database and the chat archive.
  - `desk-data`: everything on the desk.
  - Back up both (see Backups below).
- **Upgrades:**
  1. Back up first (see Backups).
  2. Get the new version into your Kith folder: `git pull` if it's a git clone, or copy the new files over the old
     ones (keep your `.env`; it isn't part of the download).
  3. Rebuild and restart: `docker compose --profile voice up -d --build` (leave out `--profile voice` if you don't
     run local voice).

  The database updates itself on start: each change is numbered and runs once, inside a transaction, so a failed
  start leaves it as it was. Stopping gives Kith a few seconds to finish requests in flight, and desk jobs that were
  interrupted carry on after the restart (one interrupted twice is marked failed). `docker compose ps` shows each
  service as healthy once it's up.

## Backups

Three things hold everything: the database (in `kith-data`, with the chat archive beside it), the desk's files (in
`desk-data`), and your `.env`. Kith can keep running while you back up.

1. A safe copy of the database. Copying `kith.sqlite` while Kith runs can catch it half-written; SQLite's
   `VACUUM INTO` writes a consistent copy instead:

   ```bash
   docker compose exec kith node --disable-warning=ExperimentalWarning -e "new (require('node:sqlite').DatabaseSync)('/data/kith.sqlite').exec(\"VACUUM INTO '/data/backup.sqlite'\")"
   docker compose cp kith:/data/backup.sqlite ./kith-$(date +%F).sqlite
   docker compose exec kith rm /data/backup.sqlite
   ```

2. The chat archive and the desk's files:

   ```bash
   docker run --rm -v kith_kith-data:/v:ro -v "$PWD":/backup alpine tar czf /backup/kith-history-$(date +%F).tgz -C /v history
   docker run --rm -v kith_desk-data:/v:ro -v "$PWD":/backup alpine tar czf /backup/desk-data-$(date +%F).tgz -C /v .
   ```

3. A copy of `.env`.

Keep backups private, and somewhere other than the server itself: they hold chats, memories, reports and (in `.env`)
your secrets. The saved API key and Google tokens in the database are encrypted with `KITH_SECRET_KEY`, so a database
copy is only useful together with the same `.env`. Backups keep data past the retention period, so delete old ones on
the same schedule (30 days, or what you set).

To restore the database, stop Kith, put the copy in the volume as `kith.sqlite` (and remove any `kith.sqlite-wal` and
`kith.sqlite-shm` beside it), then start Kith again:

```bash
docker compose stop kith
docker run --rm -v kith_kith-data:/v -v "$PWD":/backup alpine sh -c "cp /backup/kith-2026-11-25.sqlite /v/kith.sqlite && rm -f /v/kith.sqlite-wal /v/kith.sqlite-shm && chown 1000:1000 /v/kith.sqlite"
docker compose start kith
```

## Skills and /commands

In the parent view, **Skills** holds how-tos you write for the companion (how to help with maths, how to run a quiz,
your rules for game nights). The companion sees each skill's name and when to use it, and loads the full text (with
its `use_skill` tool) only when it's relevant. Give a skill a command (like `quiz`) and your child can type `/quiz` in
chat to use it straight away; typing `/` shows the list. Your safeguards always come first, whatever a skill says.
Three examples are ready to start from. Built-in commands are always there too: `/help`, `/usage`, `/connectors`,
`/skills`, `/reload-skills`, `/memory`, `/schedule`, `/desk`, `/new`, `/call`, `/grownup`, `/settings`. The info ones
show a card in the chat without asking the companion, so they use no energy; skills can't reuse these names. Your child can see the skills that are on under Settings › Connectors and
skills.

## Heartbeat

Every 30 minutes, always (it can't be switched off), the companion looks over what's coming up (reminders, exam
dates, things it made, things your child mentioned) against a checklist you can edit in Settings › Heartbeat, and
decides whether anything needs doing. Usually nothing does. When something does, it sends one gentle check-in (within
your daily limit, never in quiet hours, never while they're chatting, safety-checked) or writes a line in its journal.
It runs on Low power from the desk's budget, beats "asleep" in quiet hours without calling Claude, and doesn't call
Claude when nothing has changed. Your child sees it at the top of the profile's Scheduled tab.

## Safeguards

The safeguards document always comes first, ahead of everything your child writes and every skill. In Settings ›
Safeguards you can edit the whole document (or reset it to the built-in version) and add family rules. Whatever it
says, the separate safety check, reporting (child told first) and Grown-up? keep working.

## First run and help

The first time your child signs in, a short wizard sets up their companion (name, personality, voice, what it helps
with, notifications, and how staying safe works). Both sides have a help centre: Settings › Help for your child, and
Help in the parent view.

## Signing in from an installed app

When Kith is added to the Dock (Safari › File › Add to Dock) or to an iPhone Home Screen, the sign-in page (Pocket
ID) is outside the app, and its passkeys need a real browser. Kith handles this itself:

1. When the sign-in page shows, the app gets Pocket ID's address ready with a random one-time id
   (`/auth/login?handoff=<id>&json=1`).
2. "Sign in with Pocket ID" opens that address in a normal browser tab, not a popup. Safari blocks windows that open
   after a wait, which is why the address is fetched in advance.
3. When sign-in finishes, the tab says "You're signed in", and the app collects the session once (within 2 minutes)
   and carries on.

An older server falls back to a sign-in popup. In a normal browser tab, sign-in works as before. The Mac app (`mac/`)
does the same from its own window (docs/macos.md). Nothing to set up.

## Light and full

Kith runs on a small machine (for example a Late 2014 Mac mini: 4 threads, 8 GB RAM) in its **light** profile, which
is the default. Moving to a bigger machine later is only a change of settings in `.env`; nothing else changes.

| Setting (`.env`) | Light (default) | Full (a bigger machine) |
|---|---|---|
| `KITH_MEM_APP` / `KITH_NODE_HEAP_MB` | `512m` / `384` | `1g` / `768` |
| `KITH_MEM_EGRESS` | `128m` | `128m` |
| `KITH_MEM_DESK` / `KITH_DESK_SHM` | `768m` / `256m` | `1536m` / `512m` |
| `KITH_MEM_WHISPER` | `1536m` | `3g` |
| `KITH_MEM_PIPER` | `512m` | `1g` |
| `KITH_WHISPER_MODEL` | `base-int8` | `tiny-int8` on very slow machines; `small-int8` on fast ones |
| `KITH_DESK_BROWSER_IDLE_MINUTES` | `2` | `5` |

Measured in the light profile with the tiny model: about 0.35 GB for all five containers when idle, about 0.6 GB
during a call (Whisper about 170 MB, Piper about 165 MB), and about 0.2 GB more while the desk's browser is running.
The limits above are ceilings with headroom, not what's used. After changing any of them, run
`docker compose --profile voice up -d` (no rebuild needed).

**What only runs when it's needed**

- **The desk's browser (Chromium)** starts when a desk job looks something up, or when someone takes over, and stops
  after `KITH_DESK_BROWSER_IDLE_MINUTES` of quiet. Its caches are cleared each time it stops (cookies and site data
  stay). The desk screen in the app also sleeps after two minutes.
- **Voice** (Whisper and Piper) keeps its model in memory while its container runs. Kith doesn't start and stop
  containers itself, because that would mean giving it control of Docker, which is effectively root on the server.
  On a small machine you have three good options:
  1. Keep the light model (`tiny-int8`) and the memory limits above.
  2. Leave the voice containers off (start Kith without `--profile voice`). Calls then won't work, and everything else
     does.
  3. Use a Wyoming server that's already running elsewhere (another machine, or Home Assistant's). Set it in the parent
     view › Settings › Voice, or with `KITH_STT_HOST` / `KITH_TTS_HOST` in `.env`.

**Voice settings in the parent view.** Settings › Voice chooses the listening model and the voices your child can pick,
and can point at another Wyoming server. "Check the voice servers" asks both what they have. Piper fetches new voices
as needed. The bundled Whisper container loads one model when it starts, so to change it set `KITH_WHISPER_MODEL` and
restart that container; the check tells you if they don't match.

## Disk budget

Settings › Storage sets a total budget for Kith (15 GB by default) and a cap on the desk's files (5 GB). The
Overview shows how much is used. When the desk's files reach their cap, or everything reaches the total, new desk work
waits until there's room; chat keeps working. Deleted desk items go to the trash and are removed after 7 days
(adjustable), along with any desk screenshots (none are saved today: the live view is kept in memory only). The desk
also has its own hard cap, `KITH_DESK_MAX_GB` (5 by default).

## Moving Kith to another machine

Everything Kith keeps is in two Docker volumes plus your `.env`:

- `kith_kith-data`: the database (settings, chats, memories, reports, skills), the chat archive, the encrypted API key
  and Google tokens.
- `kith_desk-data`: the desk's files, its trash and the desk browser's saved data.
- `.env`: your settings and secrets.

(`kith_whisper-data` and `kith_piper-data` only hold downloaded models and voices; they download again on their own.)

**Keep `KITH_SECRET_KEY` exactly the same.** The API key you saved in the parent view and the Google tokens are
encrypted with it; with a different key they can't be read (you'd have to enter them again).

1. On the old machine, stop Kith and back up:

   ```bash
   docker compose --profile voice down
   for v in kith-data desk-data; do
     docker run --rm -v kith_$v:/v -v "$PWD":/backup alpine tar czf /backup/$v.tgz -C /v .
   done
   ```

   Copy `kith-data.tgz`, `desk-data.tgz` and `.env` to the new machine (keep `.env` private: it has your secrets).

2. On the new machine, get Kith (the same version), put `.env` in the Kith folder, and restore:

   ```bash
   for v in kith-data desk-data; do
     docker volume create kith_$v
     docker run --rm -v kith_$v:/v -v "$PWD":/backup alpine sh -c "cd /v && tar xzf /backup/$v.tgz"
   done
   docker run --rm -v kith_desk-data:/v alpine chown -R 1001:1001 /v
   ```

3. Adjust `.env` for the new machine if you like (see Light and full, or `KITH_PUBLIC_URL` if the address changed),
   then start it:

   ```bash
   docker compose --profile voice up -d --build
   ```

4. Check the parent view: the Set-up checklist, Settings › Claude ("Key …abcd is set"), Settings › Voice ("Check the
   voice servers") and Storage. If you use Pocket ID and the address changed, update the redirect URL there too.
