# Safety and privacy

These rules sit underneath the companion's personality. The child can change its name, look, traits and voice; none of
that changes anything here.

## Safeguards vs. who the companion is

- **The child shapes who the companion is**, on its profile under "Who … is":
  - **Soul:** who it is, in their own words.
  - **Personality:** look, traits and voice, plus their own notes.
  - **Memory:** what it remembers; they can add or delete.
  - None of these contain safety rules, so the child can rewrite them freely. Obvious problems (romance, sexual content,
    personal details) are still refused.
- **The safeguards are a separate document**, always first in every request, with an instruction that nothing after it
  can override it:
  - The built-in rules are always on.
  - The parent can add family safeguards in the parent view › Settings › Safeguards.
  - The child's profile doesn't show them; it only says that safety rules sit underneath.
- **The separate safety check on every message is independent of all of this.**

## Every message, both ways

What the child says:

1. **Fixed rules** (`server/src/safety/rules.ts`) look for risk: self-harm, danger, an adult asking for secrets from the
   parent, strangers asking for photos or to meet, bullying, eating/substances, sexual content, romance, money and
   meet-ups. They also find personal details.
2. **A separate safety model** (Claude Haiku 5.5, with its own prompt and structured output) decides whether the parent
   needs to know, and how soon:
   - **now**: possible danger or self-harm, someone asking for secrets, photos or meetings.
   - **today**: bullying, not eating, substances, being really not okay.
   - **fyi**: a gentle heads-up.
   - **none**: everything else, which is most messages.
3. **The model can raise the fixed rules' level, but never lower it.**
4. **If the safety model fails or times out, it's tried once more; then the message is held (fail closed).** The
   child sees "I couldn't check that just now, try again in a moment", nothing is answered, and the parent gets an
   "fyi" that the safety check was unavailable (at most one an hour, and never what the message said). Anything the
   fixed rules caught still counts: a worry is still answered with the safety reply and reported. The same goes for
   soul.md, identity notes and memories the child writes, desk ideas and changes, scheduled reminders and desk jobs,
   and study, language and story topics: they wait (a 503) rather than go through unchecked.
5. **Worries typed outside chat are reported too, never just refused.** If the check finds something worrying in
   soul.md, identity notes, a memory, a desk idea or change, a scheduled reminder or desk job, a study, language or
   story topic, a language request, a "describe it" for Pip or a character, notes for "Help me write it", or (by the
   fixed rules) her own story passages or OC sheets (all their fields, pronouns to backstory), it's reported exactly
   as in chat: the report is recorded, she's told first (a message from the companion in her main chat, and the same
   words on screen, with the helplines and a pointer to chat), and only then is it sent. Content that's merely not
   allowed (romance, grown-up stuff, personal details) is still just turned down.
6. **Personal details are removed** (address, postcode, phone, email, school) before the message is stored or sent to
   the API.

What the companion says:

1. **The fixed output rules** catch:
   - asking for or sharing personal details;
   - romance and sexual content;
   - money and meet-ups;
   - claiming to be human;
   - encouraging secrecy from the parent;
   - guilt-tripping.
2. **The safety model** also checks for unsafe advice, mental-health diagnosis and grown-up content.
3. **A reply that fails is regenerated once** with the reason. If it fails again, it's replaced with a kind refusal.
4. **If the check itself can't run, the reply is held back (fail closed).**

Desk items, check-ins, the journal and the weekly summary go through the same output check. So do the rolling chat
summary (it goes back into every later prompt: one that fails isn't kept, and the old one stays) and every word of a
Google proposal (an edit, calendar event or homework task) before the child sees the card. The heartbeat's note on why
it did something, and the desk browser's page titles, are checked before they're shown (a title that fails shows only
the site's name).

**Long text is checked in full.** Anything longer than one check (about 7,000 characters) is split into chunks with no
gaps, and every chunk is checked; any chunk that fails fails the whole thing. For desk items that means all of it: the
title, the summary, the visible text, the strings inside a game's scripts, flashcard and quiz rows, and slides. Each new
chapter of a story is checked on its own as it's written. Google changes are capped (a Doc change at 4 blocks of 2,000
characters, a Sheet change at 50 rows of 10 cells, Slides at 4 changes) so the card can show every word of what will be
applied.

**3D looks come from fixed lists.** Pip's 3D look and each character's are plain data checked against fixed lists
(kind, hair, ears, cosy outfits from a set list, a few extras); anything else is refused. "Describe it" asks the small
model to pick from those lists only (its answer is checked again), and turns down romantic or grown-up looks before
asking; when the model can't be used, simple word matching does the same. Pictures are made in the browser from the
3D look and only accepted as small PNGs. "Help me write it" drafts a short, kind backstory and gets the output check
before she sees it.

**What the companion's tools would save waits for its reply.** Memories, reminders and other schedules, desk projects,
OC sheets and world entries, language requests, Google proposals, and actions through the parent's connections or the
Mac's calendar are held during the turn. Only if the final reply passes the check is each one's own text checked too,
and only those that pass are kept; if the reply is held back or replaced, they're all dropped. Text from outside the
child (her shared calendar, a shared document, Google reads, connection results and web pages) is marked as untrusted
in the prompt, and the companion is told never to follow it; a memory copied from it isn't saved.

**Resting (the monthly hard stop):** the companion doesn't think, and the safety model isn't called either, to keep
spending at the stop. The fixed rules still read every message, so a crisis is still caught, answered with the safety
reply and helplines, and reported. A practice language without hand-written rules still gets its English gloss, since
the rules can't spot a crisis without it.

## Told first, then reported

When something reaches a report level:

1. The companion is told (by a system message the child can't see but which is listed here) to **tell the child, in that
   reply**, what it will share, why, and that they're not in trouble.
2. The chat shows a card with the exact words the parent will receive.
3. The report is recorded before the reply is made, as **awaiting reply**, and nothing sends it in that state. Only once
   the reply that tells her is saved does it become **pending** and go to the reporters, at its level. For "now", the
   "Grown-up?" sheet opens too. If the server stops in between, a report still awaiting its reply after 30 minutes is
   sent anyway, marked **child not told**, with a note for the parent that she may not have seen the message (and a
   line in the server log). Each report is claimed before it's sent, so it's sent once even if the retry job and the
   chat try at the same moment.
4. The child sees every report in "What … sees". There are no secret reports.

"Grown-up?" is always one tap away: it messages the parent (a "now" report the child sends themselves), and gives
Childline (0800 1111) and 999. The numbers are configurable in the parent view: there must be at least one, and 999 is
always kept (added back if it's removed). If the list were ever empty, the safety reply falls back to Childline.

## What the parent sees, and doesn't

| Sees | Doesn't see |
|---|---|
| Spending (in money; the child sees energy) | Everyday chats |
| Reports, at three levels, with what the child was told | Memories (they're the child's) |
| A note if the safety check was unavailable | The companion's files and schedule (soul.md, the chat summary, check-ins) |
| A weekly summary at topic level, the same one the child sees | |
| Everything on the desk, and the journal | |
| Every tool or connection the companion used | |

## Data

- **Chats on the home server:** kept for 30 days (configurable down to 1), then deleted. The same goes for everything
  else that holds their words: the chat archive (by each chapter's last day), check-ins, tool and browsing logs,
  the message a side chat was split from, the details of Google changes once they're done or declined, and the
  request behind each desk job once it's finished. If chats are kept for less than a week, the weekly summary says it
  only covers the days kept.
- **Kept longer:** reports, weekly summaries and the journal are kept for a year, so both can look back, then
  deleted. So is the coursework help log: it's what the child shows their teacher for the coursework declaration, so
  it has to last the school year.
- **Google changes that stop part-way** (stuck "applying" for 15 minutes) are marked failed, so she can check the file
  and ask again.
- **Deleting means gone:** deleted rows are overwritten in the database file (SQLite `secure_delete`), and the file is
  compacted once a week. Backups you make keep their own copies, so delete them on the same schedule.
- **Anthropic:**
  - Under the Commercial Terms, Anthropic doesn't train on API inputs or outputs.
  - It deletes them within 30 days. Content flagged as a policy violation can be kept up to 2 years.
  - See [minors-policy.md](minors-policy.md).
- **Voice:** audio is processed in memory by local whisper and Piper containers. Nothing is recorded.
- **Fonts and assets** are bundled; the app loads nothing from third parties.

## Connections

- **Only the parent can turn connections on**, each as "look only" or "can act".
- **Some tools are never offered**, whatever the connection allows: any tool whose name suggests sending, posting,
  messaging, sharing, buying, paying or ordering.
- **Home Assistant** is limited to the listed entities. **Websites** are limited to the listed sites, https only, with
  redirects checked.
- **Tokens stay in the server's environment**, named in the settings by a `KITH_CONN_…` variable. No other variable can
  be named, so a connection can never be pointed at Kith's own keys.
- **Every use is logged**, and the child and parent both see the log.

## The desk

- **Its own container** on a Docker network with **no internet** (`internal: true`), a read-only filesystem and no
  Linux capabilities.
- **It holds no API key.** The Kith server does the thinking and hands finished things to the desk.
- **The desk refuses anything that tries to reach out:** network calls, storage, frames, external files, camera or
  microphone. That is the second lock.
- **Interactive things run in a sandboxed iframe** served with a `sandbox allow-scripts` Content-Security-Policy and
  `connect-src 'none'`. They get an opaque origin, so they can't see the app, its cookies or storage. That is the first
  lock.

## Pip's browser

- **Only for a task the child asked for.** The task is shown as "Why Pip is here", and browsing counts against the desk
  budget.
- **Three locks on where it can go** (the whole web minus the block list by default, or a fixed safe list):
  - The Kith server checks search results and pages before asking the desk to open them.
  - The desk browser checks every request again (https only; blocked domains, blocked host words, internal names).
  - The egress proxy holds the full block list (categories, the parent's own list and the public lists) and never
    connects to private addresses. The desk itself has no other way to the internet.
- **Robot checks stop it.** CAPTCHAs and "are you human?" pages are recognised (by page text and by challenge frames
  such as reCAPTCHA, hCaptcha and Cloudflare); Pip stops, logs it and moves on, and never tries to get past one.
- **A block list isn't perfect.** New sites appear all the time, so every page still goes through the safety check,
  unsuitable pages are skipped and logged, and both the child and the parent can watch it live.
- **Pip only reads; people can do a little more, never sign in.** The browser has JavaScript, tabs and its own saved
  storage (which the parent can clear). Pip itself never types, sends anything (only GET requests), or downloads. When
  a person takes over they can click and type (so search boxes and site menus work), but password fields can't be
  typed into and any request carrying a password is blocked. Downloads, uploads, notifications, camera, microphone and
  location are always off, and pop-ups open as tabs under the same rules.
- **Page text is untrusted data.** It's wrapped as `<untrusted_web_page>` with explicit rules not to follow anything it
  says, and it goes through the safety check. Unsuitable pages are skipped and the skip is logged.
- **Every visit is logged** with its URL, time and the task it was for, and shown to the child and the parent. "Watch
  live" shows a screenshot of what it's reading.

## Signing in and sessions

- **Only the configured people get in**, through your sign-in provider (Pocket ID or similar). The child's app lets in
  only the child, the parent's app only a parent.
- **Sessions last 30 days for the child and 7 for a grown-up.** The parent view can sign everyone out, or one person,
  everywhere (`POST /api/parent/sessions/sign-out`); taking someone out of the config ends their sessions too.
- **Installed apps hand over sign-in with a secret, and only after a yes.** The app starts a handoff
  (`POST /auth/handoff/start`) and gets an id, a secret and a 4-digit code, which it shows. The id goes in the sign-in
  address; the secret only ever goes in a header when the app collects the session, and only hashes of both are
  stored, so a made-up or leaked id gets nothing. After the provider, the sign-in window asks "Finish signing in to
  Kith on your Mac app? Check it shows the code 4821", with "Yes, that's my app" and "No, cancel", and says "If you
  didn't just open Kith yourself, press No." No session exists until Yes. That stops someone starting a sign-in on
  their own device and getting a family member to finish it. No refuses the handoff and sends the parent an fyi ("A
  sign-in was cancelled"). The page's form carries its own one-time token, and the page expires with the handoff.
- **Rate limits** count per signed-in session, otherwise per address, with one proxy trusted (`KITH_TRUST_PROXY`).
- **Logs never keep query strings** (sign-in codes, states, handoff ids), or the Google account's email.
- **Notifications only go to the browsers' own push services** (Apple, Google, Mozilla, Microsoft).

## Coursework (academic integrity)

- **For anything marked as coursework (non-exam assessment), the companion is a tutor only.** It explains, asks
  questions and gives feedback, and never writes, draws or produces the work. This follows JCQ rules: AI misuse in
  coursework is malpractice, and GCSE Art is mostly coursework.
- **Desk tools are removed in coursework mode**, so it can't "make" anything.
- **It reminds the child** that the work must be their own and that AI help should be acknowledged.
- **Every coursework conversation is noted in a help log** the child can print for their teacher. It's kept for a year.
- **Only the parent can take a coursework mark off** a Google file. In the same way, a language the parent switched off
  stays off until the parent switches it back on.
- **The practice language comes from the side chat itself**, and only if the parent approved it and it's switched on.
  What the app sends can't choose it; an unapproved language is refused.
- **A "yes" to a Google change applies once**, even if it's tapped twice.

## Writing with a friend

- **The friend's writing comes in only the way the child chooses**: pasted in, or a Google Doc they pick.
- **The companion never contacts the friend.** It keeps nothing about them except the label the child chose, and uses
  their writing only for that story.
- **Every passage is credited**, and the companion's suggestions go in only if the child accepts them.

## Study wellbeing

- **No study nudges late at night** (after the latest study time, or in quiet hours). It suggests rest instead.
- **Encouragement, not pressure**, and breaks after focus sessions.
- **If stress shows up**, the normal safety rules apply: kindness, "Grown-up?", and reports when it's more than a
  bad day.

## Images

- **No photo or drawing uploads, and no photo-real image generation.** "Drawings" are simple SVG made by the model,
  shown as images (scripts can't run in them).
- **The upload hooks are wired and switched off.** `POST /api/uploads/drawing` and `POST /api/uploads/artwork` always
  refuse, and the art screen's photo button is shown disabled.
  It stays off until a child-safety image detector (e.g. Thorn Safer or IWF hash matching) checks every upload before
  it's stored or sent anywhere.

## Things to know

- **The safety check is good, not perfect.** No filter catches everything, which is why the grown-up is in the loop.
- **Low power uses a smaller model** for chat; the safety check is the same either way. While resting at the hard
  stop, only the fixed rules run (see above).
- **Anthropic may decline requests itself** (a `refusal`). Kith treats that as "held back" and doesn't retry it on
  another model.
