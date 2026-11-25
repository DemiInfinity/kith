# Kith

**A companion that grows up with you: it talks, remembers, checks in and makes things, kept at home with your grown-up in the loop.**

Kith is a self-hosted AI companion for a teenager. It runs on your own home server, behind your own sign-in, on your own
Anthropic API key. The child names it, picks its look and personality, chats and calls it, and it makes little things on
its own offline "desk". A grown-up is in the loop honestly: the child always knows what's shared, and nothing is secret.

It's a phone web app (installable PWA) and the same app laid out for a laptop or Mac.

## What it does

- **Chat and voice calls**:
  - Typed chat, or a voice call with live captions.
  - Speech-to-text and text-to-speech run locally (faster-whisper and Piper, over the Wyoming protocol). Recordings
    aren't kept.
  - The child calls the companion; it never calls them.
- **Full power 🔥 / Low power 🔋**:
  - Full power uses Claude Sonnet 5.5; Low power uses Claude Haiku 5.5.
  - The server enforces a weekly budget and a rolling 5-hour budget.
  - The child sees an energy bar; the grown-up sees money.
  - When energy runs low it switches to Low power by itself.
- **Theirs to shape**:
  - Name, look (fox, cat, dragon, robot, star, frog, owl, panda), traits, how chatty, silly and detailed it is, and a
    voice.
  - An animated SVG face that breathes, blinks, shows moods (happy, thinking, sleepy on Low power) and moves its mouth
    with its voice.
- **Memory they control**: the companion remembers what matters (a test on Wednesday, loves dragons). The child sees
  and can delete every memory.
- **Gentle check-ins**:
  - Web push, at most twice a day, never in quiet hours, never guilt-tripping, and only the kinds the child switched on.
- **Its desk and the Studio**:
  - An offline container where the companion makes things: stories, choose-your-own adventures, quizzes that mark
    themselves, flashcards, revision timers, mini games, comics, slides, posters, cards, sketches, palettes, maps and
    timelines.
  - Interactive things run in a locked sandbox (no network, no storage, no access to the app).
  - The child can ask for changes ("make it harder"). The desk has its own monthly budget.
- **OC workshop**:
  - Original characters: sheets, relationships, a world, and a gallery on the desk.
  - Friendships, rivalries and adventures yes; romance no.
- **Parent-approved connections**:
  - Look-only or can-act, all off by default: the child's room devices in Home Assistant, Kin (calendar and chores),
    Jellyfin, a calculator, a dictionary, and allow-listed websites.
  - Never anything that spends money, messages people or posts online. Every use is logged.
- **Google Drive (optional)**:
  - The child connects their own account, and things the companion makes are also saved to a Kith folder: Docs,
    Sheets, Slides and HTML.
  - Only the `drive.file` scope. It never deletes, overwrites or shares, except the folder, view-only, with the parent if
    you choose.
- **Parent view**: money, reports, the weekly summary (which the child sees too), the desk, tool use, and settings. No
  everyday chats.

## Safety, in short

Safety sits underneath the personality and doesn't change with it. Full details: [docs/safety.md](docs/safety.md).

- A **separate safety check on every message, both ways**: fixed rules plus a small model with its own prompt. If a
  reply fails, it's redone once, then replaced. If the check can't run, the reply is held back.
- **Personal details are removed** before anything leaves the house: address, postcode, school, phone, email. The
  companion never asks for them.
- **No romance, nothing sexual, no money, no meet-ups, no grown-up content.** It always says it's an AI, and nudges
  back to real friends and family.
- **"Need a grown-up?" is on every screen**: message the parent, Childline (0800 1111), 999. UK by default; the
  numbers are configurable.
- **Told first, then reported**:
  - When something is worrying, the companion tells the child what it will share and why.
  - Then the parent hears, at one of three levels: right now, today, or just so you know.
  - Reports go through a pluggable reporter; the first one posts to a Home Assistant "AI board" script.
- **Weekly summary** at topic level, the same for child and parent.
- **Chats are kept 30 days** on the home server, then deleted, and never used to train an AI.

## Statement on children's safety and privacy

Kith is built for use by a young person, with a parent or carer who runs it. The project:

- **Follows Anthropic's requirements** for products used by minors. It tells users they're talking to an AI at the
  start of every session and on every screen, and adds its own safety checks, moderation and reporting (see
  [docs/minors-policy.md](docs/minors-policy.md)).
- **Is designed for the UK GDPR and the ICO Age Appropriate Design Code**, for UK families:
  - It collects as little as it can and keeps chats on the family's own server for 30 days at most.
  - It shares only what's needed to keep the child safe, and always tells the child first.
  - Privacy is the default: no ads, no profiling, no data for training.
- **Leaves legal compliance with whoever runs it.** Each family that runs Kith is responsible for its own use and for
  following the law where they live.

**Bring your own key:** run Kith on your own Anthropic API key, on an API organisation under Anthropic's Commercial
Terms. Set a monthly spend limit in the Anthropic Console.

## Quick start

```bash
cp .env.example .env            # fill it in: see docs/setup.md
docker compose --profile voice up -d --build
```

Open http://localhost:8787. To try it without a sign-in provider, set `KITH_DEV_LOGIN=true` in `.env`. That's for local
testing only. Without an API key everything works except the companion's thinking: it says it isn't switched on yet,
and safety, reports, the desk, voice and the parent view all still run.

Without Docker: `npm install && scripts/dev-local.sh` (runs the desk and server with dev sign-in), or `npm run dev` for
hot reload (Vite on :5173, server on :8787).

## Docs

- [Setup](docs/setup.md): API organisation and spend limits, Pocket ID / OIDC, voice, the Home Assistant reporter,
  check-ins, reverse proxy.
- [Google Drive](docs/google.md): your own OAuth client, `drive.file`, Family Link, testing-mode token expiry.
- [Safety and privacy](docs/safety.md): how the safety check, reports, retention and connections work.
- [Architecture](docs/architecture.md): how the pieces fit together.
- [Mac app](docs/macos.md): wrapping the same app with Tauri.
- [Anthropic's rules for products used by under-18s](docs/minors-policy.md).

## Development

```bash
npm install
npm test          # server, desk and client tests
npm run typecheck
npm run build
```

Node 22.13 or newer (Kith uses the built-in `node:sqlite`).

## Licence

Not chosen yet.
