# Anthropic's rules for products used by under-18s

Checked on 24 November 2026, before any code was written. These are paraphrases of the pages, not legal advice.
Read the pages yourself before you rely on them, because they change.

## Pages read

| Page | Version shown |
|---|---|
| Usage Policy: https://www.anthropic.com/legal/aup | effective 12 Nov 2026 |
| Guidelines for organizations serving minors: https://support.claude.com/en/articles/9307344 | updated 16 Mar 2026 |
| Child safety guidance for developers: https://support.claude.com/en/articles/15591275 | updated 26 Jun 2026 |
| Commercial Terms of Service: https://www.anthropic.com/legal/commercial-terms | effective 17 Jun 2025 |
| Consumer Terms of Service (UK version): https://www.anthropic.com/legal/consumer-terms | effective 8 Oct 2025 |
| How long data is kept: https://privacy.claude.com/en/articles/7996866 | updated 1 Jul 2026 |

## Decision, 24 Nov 2026

Run on an API organisation under the Commercial Terms; confirm in Console › Settings.

Kith's API usage runs on an API organisation in the Anthropic Console. That organisation is linked to the maintainer's Max plan
credit but separate from their claude.ai account. The maintainer considers it covered by the Commercial Terms. The build keeps every
minors safeguard listed below:

- an AI notice each session;
- a safety check on every message, both ways;
- reports to the parent, told to the child first;
- Childline and 999;
- a public compliance statement in the README.

**Anyone running Kith must use their own API key on an organisation under the Commercial Terms.** The open-source
release is bring-your-own-key. Setup docs say so.

## The question that led to the decision: which terms cover the API account

**Which terms apply depends on who holds the Console account.**

- **Consumer Terms:** they cover an Anthropic API key and the Console "when used by individuals".
  - You must be at least 18 to use the Services.
  - You may not share your API key or credentials, or "make your Account available to anyone else".
  - You may not use the Services for any commercial or business purpose.
  - Inputs and outputs may be used to train models unless you opt out in your account settings.
- **Commercial Terms:** they cover API use for an organisation.
  - Anthropic may not train on customer content (inputs and outputs).
  - There is no age clause. Minors are handled by the Usage Policy and the "organizations serving minors" guidelines below.
  - Those guidelines are written for organisations. They say nothing about individual developers.

**The problem for Kith:** if the Kith Console workspace belongs to an individual account under the Consumer Terms, a
14-year-old talking to Claude through the parent's key looks like a breach of two clauses: the 18+ rule and "make your
Account available to anyone else". That holds even though the key never leaves the server. The promise that chats are
"never used to train anything" (in the approved design) would also only hold after opting out of training.

A Claude Max plan is a consumer plan, so an API credit that comes with it most likely sits under the Consumer Terms. This
hasn't been checked: look at which terms the Console organisation accepted (Console › Settings › Organization).

**Ways forward (the maintainer's decision):**

1. Run Kith's API usage under an **organisation account on the Commercial Terms**, then follow the minors guidelines below.
   Whether a family-only, non-commercial app counts as organisational use is for Anthropic to say, not for us to assume.
2. Ask **Anthropic support** (support.claude.com) for a written answer: "Can a parent run a private, home-hosted app on their
   own API key for their 14-year-old, with these safeguards?" Build only once the answer is yes.
3. In the meantime, with either route, **turn off training** in the account's privacy settings if the account is under the
   Consumer Terms.

Nothing else on the pages read blocks the design.

## What Anthropic requires when minors use an API product

From the Usage Policy and the guidelines for organisations serving minors. Each item names where Kith covers it.

1. **Say it's an AI.**
   - Any consumer chatbot must tell users they're talking to an AI, at least at the start of each session or somewhere in the
     interface. The minors guidelines repeat this.
   - Kith: the Meet screen ("I'm an AI, not a person"), the sidebar note on every screen, and a reminder at the start of
     each session.
2. **Extra technical safeguards suited to the product.** The examples are age verification, content moderation and
   filtering, monitoring and reporting, and safe-use education.
   - Kith's safeguards:
     - Sign-in through Pocket ID for configured users only.
     - A separate safety check on every message, both ways.
     - Reports to the parent at three levels, told to the child first.
     - "Grown-up?" with Childline and 999.
     - Quiet hours.
3. **Anthropic's child-safety system prompt.** If Anthropic provides one, use it as one layer among several. None was
   linked from the pages read. Check again before launch.
4. **Follow the law and state that you do.**
   - Comply with child-safety and data-privacy law, and say so on a public website or in public documentation.
   - For a UK family this means UK GDPR and the ICO Age Appropriate Design Code (Children's Code). Those come from general
     knowledge, not from Anthropic's pages.
   - Kith's README will carry the compliance statement and the open-source docs will explain the safeguards.
5. **Audits.** Anthropic audits from time to time. A high violation rate without these safeguards can lead to the
   safeguards being required, or to suspension.

## Content the Usage Policy bans outright (for everyone)

These are the floor. Kith's safety rules go further.

- Sexually explicit content or erotic chat.
- Sexualising minors in any setting, fiction and roleplay included.
- Grooming, including content that impersonates a minor.
- Promoting self-harm or eating disorders.
- Deceptive techniques meant to cause emotional harm, and manipulative techniques that impair decision-making. These are
  the nearest thing to a rule against emotional dependency, so Kith never guilt-trips, has check-in limits and nudges
  back to real friends and family.

**Mental health:** assessing, diagnosing or treating mental health is a high-risk use that needs a qualified human
reviewing it. General wellness is excluded. So Kith may listen, comfort and signpost (Childline, 999, the parent), but it
must never assess or diagnose.

No page read bans companion-style apps, and none sets a separate age floor (such as 13+) for API products. Romance with a
minor is out under Kith's own rules and under the grooming and sexualisation bans.

## Images

The child-safety guidance expects detection tools (Thorn Safer, IWF) if users can **upload or generate images or video**,
or talk to each other. It also points to reporting CSAM (in the UK, to the IWF) and keeping event logs.

**For Kith:**

- No photo uploads, and no talking to other users.
- "Drawings" on the desk should stay simple SVG made by the model, never photo-real image generation.
- If image upload or image generation is ever added, add detection first.

## Data retention and training

- **Kith's own chats:** kept 30 days on the home server, then deleted.
- **Anthropic's copy:**
  - API inputs and outputs are deleted within 30 days.
  - Content flagged for a policy violation can be kept up to 2 years, and safety classifier scores up to 7 years.
  - Exceptions: zero-data-retention agreements, the Files API, and anything the law requires.
  - The parent and the child should know this. "What Mum sees" and the README will say it.
- **Training:**
  - Under the Commercial Terms, Anthropic doesn't train on API content.
  - Under the Consumer Terms, it does unless you opt out.
  - Kith's promise is "never used to train anything", so it depends on the account question above.

## Summary

| Question | Answer |
|---|---|
| Can a companion for a 14-year-old be built on the API? | Yes, under an organisation account on the Commercial Terms, with the safeguards above. |
| Can it run on an individual Console account (Consumer Terms)? | Doubtful: 18+, no making the account available to others, training unless opted out. |
| Does the Kith design already include the required safeguards? | Yes, plus a per-session AI notice and a public compliance statement in the docs. |
| What to do before building | Confirm the account type, or get Anthropic support's OK in writing. |
