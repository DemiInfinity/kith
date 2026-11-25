# Google (optional)

When your child connects their own Google account, Kith saves what it makes into a **Kith** folder in their Drive.
The desk at home always keeps everything anyway; Google is an extra home. Without Google, nothing changes.

You can also switch on three more things, each separately, in the parent view (**Connections › Google**). All three
are off until you turn them on:

- **Edit Docs, Sheets and Slides**: read and change files your child picks with the Google Picker, or that Kith made.
- **Calendar**: read their own calendar, and add events such as revision, test dates and reminders.
- **Tasks**: a **Homework** list in Google Tasks that the companion reads, adds to and ticks off with them.

## What gets saved where

| Made on the desk | Saved in Drive as | Folder |
|---|---|---|
| Stories, adventures, comics, OC stories | Google Doc | Stories (OC work: OCs) |
| Notes, flashcards, quizzes, timelines | Doc, or the HTML file plus a Google Sheet of the cards | Revision |
| Slide decks | Google Slides | Presentations |
| Games, cards, timers, palettes, sketches, maps | The HTML or SVG file | Games & artifacts |
| OC character sheets ("Save to Google") | Google Doc | OCs |

## Rules Kith keeps

**Scopes**
- The only Drive scope is **`drive.file`**: files Kith created, or files your child hands it with the Google Picker.
  Kith never asks for `drive` or `drive.readonly`, so it never sees the rest of their Drive.
- It also asks for `openid email`, to show which account is connected.
- It asks for **`calendar.events`** only if you switch Calendar on, and **`tasks`** only if you switch Tasks on.
- It never asks for Gmail, Contacts, Photos or Classroom.
- If Google grants more than Kith asked for, Kith refuses to keep the sign-in.

**Every change needs your child's yes**
- The companion only *proposes* changes. Your child sees a card in the chat with a short summary of the change, like a
  diff: lines added, removed or changed.
- Nothing changes in Google until they tap **Yes, do it**.
- A proposal expires after a day.

**Docs, Sheets and Slides**
- Only files your child picked, or that Kith made.
- Edits go through the Docs, Sheets and Slides APIs as `batchUpdate` requests. Kith never uploads over a file
  (no PATCH or PUT of file content).
- Google's version history keeps every change. To go back, open the file and use **File › Version history › See
  version history**, then **Restore this version**. Kith tells your child this after every edit.
- **Coursework is never edited.** Your child can pick a file as coursework, mark one as coursework, or tell the
  companion it's coursework. From then on Kith only reads it, explains and gives feedback (the JCQ rules: coursework must
  be their own work). Only you can take the coursework mark off.

**Calendar**
- Their **primary** calendar only. Kith reads their events.
- It creates events only after your child confirms each one.
- It changes or deletes **only events Kith made**, which are tagged with a private extended property.
- It never adds attendees and never sends notifications (`sendUpdates=none`), so nobody else is ever invited or emailed.

**Tasks**
- One list, **Homework**, created the first time it's needed. Adding and ticking off also need a yes.

**Never, whatever happens**
- Kith never deletes, trashes or moves a file, and never changes a file's sharing.
  - The code refuses any DELETE, PATCH or PUT to Drive, Docs, Sheets or Slides outright.
  - The only PATCH or DELETE it can send is to a calendar event Kith made (checked first) or to tick off a task.
- The one share it ever makes is optional: if you put your Google email in the parent view, the Kith folder is shared
  with you, **view-only**, without an email notification. Nothing is ever made public or emailed.

**Logging and control**
- Every Google read and write is logged. You see it in the parent view's tool log, and your child sees the same in
  "What … sees".
- You can switch Google, or any one feature, off at any time.
- Either of you can disconnect. Files already in Drive stay your child's.
- The refresh token is stored encrypted (AES-256-GCM) with `KITH_SECRET_KEY`, on the home server only.

## Setting up your own Google OAuth client, step by step

Kith ships no shared Google credentials. You make your own once; it takes about fifteen minutes. All secrets go in
through `scripts/setup-secrets.sh`, never by hand into the repo.

1. **Create a project.** In the [Google Cloud console](https://console.cloud.google.com/), choose **Select a project ›
   New project**, and name it, for example, "Kith".

2. **Enable the APIs.** Go to **APIs & Services › Library** and enable each of these:
   - **Google Drive API**
   - **Google Docs API**
   - **Google Sheets API**
   - **Google Slides API**
   - **Google Picker API**
   - **Google Calendar API**, only if you'll use Calendar
   - **Google Tasks API**, only if you'll use Tasks

3. **Set up the consent screen** (**Google Auth Platform**, or **OAuth consent screen**):
   - **Branding:** app name "Kith", your email as the support and developer contact.
   - **Audience:** user type **External**. Leave the publishing status as **Testing** for now.
   - **Data access › Add or remove scopes**: add these, and nothing else:
     - `openid`
     - `.../auth/userinfo.email`
     - `.../auth/drive.file`
     - `.../auth/calendar.events`, if you'll use Calendar
     - `.../auth/tasks`, if you'll use Tasks
   - **Audience › Test users**: add your child's Google account. Add your own too if you want to try it first.

4. **Create the OAuth client.** Go to **Clients** (or **Credentials › Create credentials › OAuth client ID**) and choose
   type **Web application**.
   - Under **Authorised redirect URIs**, add exactly `https://<your-kith-address>/auth/google/callback`. It must match
     `KITH_PUBLIC_URL`, including `https://` and with no slash at the end.
   - Under **Authorised JavaScript origins** (for the Picker), add `https://<your-kith-address>`.
   - Copy the **client ID** and **client secret**.

5. **Create the Picker API key.** Go to **Credentials › Create credentials › API key**.
   - Restrict it: **API restrictions › Google Picker API** only, and **Application restrictions › Websites** with
     `https://<your-kith-address>/*`.
   - Copy the key, and the **project number** from the project's dashboard (**Cloud overview**).

6. **Put the secrets in.** Run `scripts/setup-secrets.sh`, answer **y** to "Set up Google now?", and paste the
   client ID, client secret, Picker API key and project number when asked.
   - It can also set the one Google account Kith will accept (`KITH_GOOGLE_ACCOUNT`), which is a good idea.
   - `KITH_SECRET_KEY` (which encrypts the stored token) is generated by the same script if it isn't there yet. Keep it
     safe: if it changes, your child has to connect again.

7. **Restart Kith.** Then:
   - In the parent view, go to **Connections › Google**, switch it on, and switch on any of Edit, Calendar and Tasks
     you want.
   - Your child opens **Settings › Google › Connect my Google account** and says yes to what Google shows.
   - If you switch Calendar or Tasks on later, your child sees **Connect again** so Google can ask them about it.

### Testing mode: sign in again every 7 days

While the publishing status is **Testing**, Google expires the sign-in after **7 days**, so your child has to connect
again each week. Kith then shows "Google needs connecting again" and keeps saving to the desk in the meantime.

For permanent access you would publish the app (**Audience › Publish app**):
- With only `drive.file`, `openid` and `email`, no Google review is needed.
- **`calendar.events` and `tasks` are sensitive scopes**, so with Calendar or Tasks switched on, a published app needs
  **Google verification**. That's a review of a privacy policy, a homepage and a demo video, and it can take weeks.
- For one family it's usually simplest to stay in Testing and reconnect weekly. Alternatively, keep Calendar and
  Tasks off, and publish with only the non-sensitive scopes.

### Family Link

If your child's Google account is supervised with **Family Link**, a parent may need to approve Kith before it can be
connected (Family Link › your child › Controls › Third-party apps, or the approval request sent to you). Under-13
accounts may not be able to connect third-party apps at all.
