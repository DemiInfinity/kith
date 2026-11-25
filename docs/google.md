# Google Drive (optional)

When the child connects their own Google account, Kith also saves what it makes into a **Kith** folder in their Drive.
The desk at home always keeps everything anyway; Google is an extra home. Without Google, nothing changes.

| Made on the desk | Saved in Drive as | Folder |
|---|---|---|
| Stories, adventures, comics, OC stories | Google Doc | Stories (OC work: OCs) |
| Notes, flashcards, quizzes, timelines | Doc, or the HTML file plus a Google Sheet of the cards | Revision |
| Slide decks | Google Slides | Presentations |
| Games, cards, timers, palettes, sketches, maps | The HTML or SVG file | Games & artifacts |
| OC character sheets ("Save to Google") | Google Doc | OCs |

## Rules Kith keeps

- **Only the `drive.file` scope**, plus `openid email` to show which account is connected.
  - Kith sees only files it created, or a Google Doc the child chooses to hand it with the Google Picker.
  - It never sees the rest of their Drive, Gmail or Photos.
  - If Google grants more than that, Kith refuses to keep the sign-in.
- **It only ever creates files and folders.** It never deletes, overwrites or edits the child's files: a change is saved
  as a new file alongside ("… (v2)"). The code refuses DELETE, PATCH and PUT calls to Google outright.
- **No sharing**, except one thing: if the parent puts their Google email in the parent view (Connections › Google
  Drive), the Kith folder is shared with them, **view-only**, without an email notification.
  - Nothing is ever made public or emailed.
  - Sharing a story with a friend is the child's own choice, done in Google Drive.
- **Every Google write is logged** (folder, file, share) and shown in the parent view and in "What … sees".
- **The parent can switch Google off** in the parent view, and either of them can disconnect it. Files already in Drive
  stay the child's.
- **The refresh token is stored encrypted** (AES-256-GCM) with `KITH_SECRET_KEY`, on the home server only.

## Setting up your own Google OAuth client

Kith ships no shared Google credentials. Each family (or each person running Kith) makes their own. It takes about
ten minutes.

1. **Create a project** in the [Google Cloud console](https://console.cloud.google.com/), e.g. "Kith".
2. **Enable the APIs** (APIs & Services › Library): **Google Drive API** and **Google Slides API**. Docs and Sheets are
   created by Drive's import, so those APIs aren't needed.
3. **Set up the consent screen** (OAuth consent screen, or "Google Auth Platform"):
   - User type **External**, app name "Kith", your support email.
   - Scopes: add `.../auth/drive.file`, `openid` and `email`. These are all **non-sensitive**, so no Google verification
     is needed.
   - **Test users**: add the child's Google account while the app is in Testing.
4. **Create the credentials** (Credentials › Create credentials › OAuth client ID): type **Web application**.
   - Authorised redirect URI: `https://<your-kith-host>/auth/google/callback` (it must match `KITH_PUBLIC_URL`).
   - Put the client ID and secret in `.env` as `KITH_GOOGLE_CLIENT_ID` and `KITH_GOOGLE_CLIENT_SECRET`.
5. **Set a secret key** with `openssl rand -hex 32`, as `KITH_SECRET_KEY` in `.env`. It encrypts the stored token. Keep
   it safe: if it changes, the child has to connect again.
6. **Optional:** `KITH_GOOGLE_ACCOUNT=child@gmail.com` pre-fills the account and refuses any other.
7. **Optional, for the Google Picker** (so the child can hand Kith a doc, e.g. a friend's part of a shared story):
   - Create an **API key** restricted to the Google Picker API and your Kith host as the HTTP referrer.
   - Enable the **Google Picker API**.
   - Set `KITH_GOOGLE_PICKER_API_KEY`, and set `KITH_GOOGLE_PROJECT_NUMBER` to the project number (shown on the project's
     dashboard).
   - With these set, the app also allows Google's Picker scripts in its Content-Security-Policy. Without them, the
     Picker stays off and pasting text still works.
8. **Restart Kith.** The child opens **You › Google Drive › Connect my Google account**, and the parent switches on
   **Connections › Google Drive** in the parent view.

### Testing mode: tokens expire after 7 days

While the consent screen's publishing status is **Testing**, Google expires refresh tokens after **7 days**, so the child
would have to reconnect every week. Kith then shows "Google needs connecting again" and keeps saving to the desk.

To avoid this, set the publishing status to **In production** (OAuth consent screen › Publish app). With only
non-sensitive scopes (`drive.file`, `openid`, `email`) this needs no verification review. People outside your test-user
list may see an "unverified app" notice until you add a privacy policy and homepage, but your own family can continue.

### Family Link

If the child's Google account is supervised with **Family Link**, a parent may need to approve Kith before it can be
connected (Family Link › the child › Controls › Third-party apps, or the approval request sent to the parent). Under-13
accounts may not be able to connect third-party apps at all.
