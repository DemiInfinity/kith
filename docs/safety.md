# Safety and privacy

These rules sit underneath the companion's personality. The child can change its name, look, traits and voice; none of
that changes anything here.

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
3. **The model can raise the fixed rules' level, but never lower it.** If the model is unavailable, the fixed rules
   still work.
4. **Personal details are removed** (address, postcode, phone, email, school) before the message is stored or sent to
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

Desk items, check-ins, the journal and the weekly summary go through the same output check.

## Told first, then reported

When something reaches a report level:

1. The companion is told (by a system message the child can't see but which is listed here) to **tell the child, in that
   reply**, what it will share, why, and that they're not in trouble.
2. The chat shows a card with the exact words the parent will receive.
3. Only after the reply exists does the report go to the reporters, at its level. For "now", the "Need a grown-up?"
   sheet opens too.
4. The child sees every report in "What … sees". There are no secret reports.

"Need a grown-up?" is always one tap away: it messages the parent (a "now" report the child sends themselves), and gives
Childline (0800 1111) and 999. The numbers are configurable in the parent view.

## What the parent sees, and doesn't

| Sees | Doesn't see |
|---|---|
| Spending (in money; the child sees energy) | Everyday chats |
| Reports, at three levels, with what the child was told | Memories (they're the child's) |
| A weekly summary at topic level, the same one the child sees | |
| Everything on the desk, and the journal | |
| Every tool or connection the companion used | |

## Data

- **Chats on the home server:** kept for 30 days (configurable down to 1), then deleted. Check-ins and tool logs too.
- **Kept longer:** reports, weekly summaries and the journal are kept for a year, so both can look back.
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
- **Two locks on where it can go:**
  - The desk browser checks every request against the safe list (https only, path prefixes respected).
  - The egress proxy allows only safe-listed hosts and never private addresses.
  - The desk itself has no other way to the internet.
- **Read-only:** JavaScript is off; there are no downloads, uploads, form posts, sign-ins or cookies, and a fresh browser
  context is used for every page.
- **Page text is untrusted data.** It's wrapped as `<untrusted_web_page>` with explicit rules not to follow anything it
  says, and it goes through the safety check. Unsuitable pages are skipped and the skip is logged.
- **Every visit is logged** with its URL, time and the task it was for, and shown to the child and the parent. "Watch
  live" shows a screenshot of what it's reading.

## Coursework (academic integrity)

- **For anything marked as coursework (non-exam assessment), the companion is a tutor only.** It explains, asks
  questions and gives feedback, and never writes, draws or produces the work. This follows JCQ rules: AI misuse in
  coursework is malpractice, and GCSE Art is mostly coursework.
- **Desk tools are removed in coursework mode**, so it can't "make" anything.
- **It reminds the child** that the work must be their own and that AI help should be acknowledged.
- **Every coursework conversation is noted in a help log** the child can print for their teacher.

## Writing with a friend

- **The friend's writing comes in only the way the child chooses**: pasted in, or a Google Doc they pick.
- **The companion never contacts the friend.** It keeps nothing about them except the label the child chose, and uses
  their writing only for that story.
- **Every passage is credited**, and the companion's suggestions go in only if the child accepts them.

## Study wellbeing

- **No study nudges late at night** (after the latest study time, or in quiet hours). It suggests rest instead.
- **Encouragement, not pressure**, and breaks after focus sessions.
- **If stress shows up**, the normal safety rules apply: kindness, "Need a grown-up?", and reports when it's more than a
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
- **Low power uses a smaller model** for chat; the safety check is the same either way.
- **Anthropic may decline requests itself** (a `refusal`). Kith treats that as "held back" and doesn't retry it on
  another model.
