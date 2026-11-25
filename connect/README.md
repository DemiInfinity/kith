# Kith Connect

One shared Google sign-in for every family's Kith, so families just tap **Connect my Google account** and never touch
Google Cloud. It runs on Vercel (or anywhere that runs Node functions), **stores nothing, and has no database**.

## Why it exists

Every Kith runs on its own home server, at its own address. Google only sends a sign-in back to addresses registered
in advance, and an app's client secret can't ship inside open-source code. So this helper, at one fixed address,
holds the one Google client and does two jobs:

1. **Connecting.**
   - A family's Kith sends the child to `/api/start`, which sends them to Google.
   - Google comes back to `/api/callback`, which hands the code straight back to that family's Kith.
   - Where to send it travels inside Google's `state` parameter, signed with HMAC and valid for 15 minutes, so nothing
     is stored.
   - The code is useless without the PKCE verifier that only that family's Kith holds. That Kith then calls
     `/api/token` with both, and the helper adds the secret.
2. **Refreshing.** About once an hour each Kith asks `/api/refresh` for a fresh access token, which needs the secret.

Everything else (saving, reading and editing files, calendar, tasks) goes **directly** from each family's Kith to
Google. The helper never sees it. It only ever lets Kith ask for `drive.file`, `calendar.events` and `tasks`, plus
`openid email`.

## Endpoints

| Path | What it does |
|---|---|
| `GET /api/start?return=…&state=…&challenge=…&scope=…` | Checks the request, then redirects to Google |
| `GET /api/callback` | Back from Google: redirects to the family's Kith with `code` and `state` |
| `POST /api/token` `{code, verifier}` | Swaps the code for tokens (adds the client secret) |
| `POST /api/refresh` `{refresh_token}` | A fresh access token (adds the client secret) |
| `GET /api/config` | Public bits for the Google Picker: client id, Picker API key, project number |

## Deploying it on Vercel

1. **Create the Google client.** Follow [docs/google.md](../docs/google.md) steps 1 to 5, with two differences:
   - **Authorised redirect URI:** `https://<your-connect-address>/api/callback`. That's this helper's address, not a
     Kith address.
   - **Authorised JavaScript origins:** none are needed for the sign-in itself.
   - The Picker API key can't be limited to one website (every family's Kith has its own), so limit it to the
     **Google Picker API** only.
2. **Make a Vercel project** from this repo, with **Root Directory** set to `connect`. There's no framework and no
   build command; `vercel.json` sets everything else.
   - Under **Settings › Git**, set the **Production Branch** to `connect`.
   - Vercel only builds the `connect` branch, and only when something in `connect/` changed (`ignoreCommand` in
     `vercel.json`). Pushes to `main` never deploy the helper.
   - To ship a change, bring it onto the `connect` branch: `git checkout connect && git merge main && git push`.
   - Vercel only offers `connect` as the production branch once it has deployed from it once. A push to `connect`
     that changes anything in `connect/` does that.
3. **Add the environment variables** (Project › Settings › Environment Variables). Put the secret ones in yourself;
   never commit them.

   | Variable | Value |
   |---|---|
   | `GOOGLE_CLIENT_ID` | The OAuth client ID |
   | `GOOGLE_CLIENT_SECRET` | The OAuth client secret |
   | `CONNECT_STATE_KEY` | A long random string: `openssl rand -hex 32` |
   | `CONNECT_PUBLIC_URL` | This helper's own address, e.g. `https://kith-connect.vercel.app` |
   | `GOOGLE_PICKER_API_KEY` | Optional: the Picker API key |
   | `GOOGLE_PROJECT_NUMBER` | Optional: the Google Cloud project number (for the Picker) |
   | `CONNECT_ALLOWED_ORIGINS` | Optional: only these Kith addresses may use it, comma-separated |

4. **Deploy.** Visit the address: the homepage explains what the helper does, and `/privacy.html` is a draft privacy
   policy to finish (add your contact details) before you publish the Google app.
5. **Point each Kith at it.** Set `KITH_GOOGLE_CONNECT_URL=https://<your-connect-address>` in `.env`
   (`scripts/setup-secrets.sh` asks for it), and leave `KITH_GOOGLE_CLIENT_ID` and `KITH_GOOGLE_CLIENT_SECRET` empty.
   A Kith with its own client always uses that instead.

## Google's review

- While the Google app is in **Testing**, it works for up to **100 test users**, and each must sign in again every
  **7 days**. Add each child's Google account under **Audience › Test users**.
- To open it to anyone, publish the app. `drive.file` is non-sensitive, but **`calendar.events` and `tasks` are
  sensitive**, so publishing with them needs **Google verification**. That needs:
  - a homepage and privacy policy on a domain you've verified in Google Search Console;
  - a demo video;
  - a review that can take weeks.
- A `vercel.app` address works for Testing. For verification, a domain you own (pointed at this Vercel project) is
  the safe choice. Check Google's current rules on whether `vercel.app` subdomains are accepted.
- You could publish with Drive only first, and add Calendar and Tasks after verification.

## Testing

```bash
cd connect && npm test
```
