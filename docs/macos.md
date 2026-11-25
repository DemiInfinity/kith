# The Mac app

`mac/` is Kith for the Mac: a small [Tauri 2](https://tauri.app) app, written in Rust, whose window shows your own Kith
server. It looks and works exactly like the web app's desktop layout:

- a sidebar with the avatar, mood, energy bar and sections;
- chat in the middle;
- the companion's desk on the right, "live from home".

The web app switches to that layout at 1100px wide or more, so the window never gets narrower than that.

Because the window loads the live server, sign-in, cookies, the sandboxed desk frames and every future change to the web
app are the same in the Mac app, with nothing to rebuild. There's no second UI to maintain.

On top of that, the app gives Pip a few parts of the Mac (see "Pip and the Mac" below): notifications, Calendar and
Reminders, documents she chooses, and a shortcut to call Pip from anywhere.

## What the app adds

- **A proper Mac window:** about 1500×920 the first time, then it remembers its size and position. The title bar blends
  into Kith's plum background (`#1C1219`) and the title is hidden.
- **The Buddy icon** from `design/icon/icons/desktop/icon.icns`.
- **⌘R reloads.** View › Reload goes through the start page, so if home can't be reached you get the friendly screen,
  not a blank window.
- **A start page** (`mac/launcher/`, bundled in the app):
  - On every launch and reload it checks the server answers before showing it.
  - If home can't be reached it says so, with "Try again". It also tries again by itself every 15 seconds and when the
    Mac comes back online.
  - Kith › Change Server… brings the address form back, except in a build with a server baked in (see "Setting the
    server address").
- **The microphone** for voice calls. macOS asks once, with "Kith listens when you tap the mic during a call."
- **The start page's content security policy** (`app.security.csp` in `mac/src-tauri/tauri.conf.json`): its own
  script and image only, no inline script, and network requests only to check the server answers.
- **The usual Mac menus:** Edit (copy, paste, undo), View, Window and Kith › Quit.
- **The menu bar:** closing the window keeps Kith running in the menu bar (Open Kith, Call Pip, Quit Kith), so
  notifications still arrive. Clicking Kith in the Dock brings the window back.

## Pip and the Mac

Each of these asks the child the first time (macOS's own prompts) and can be switched off again in System Settings ›
Privacy & Security.

| What | How it works | Safeguards |
| --- | --- | --- |
| **Notifications** | Pip's check-ins, reminders and "your thing is ready" show as Mac notifications, even with the window closed. The page polls the server every 30 seconds. | Same choices as on her phone (Settings › Notifications). Up to 5 a minute show as they are; any more are gathered into one "N more notifications" a few seconds later, so none are lost. |
| **Calendar & Reminders** | Off until she ticks **Kith › Share Calendar & Reminders with Pip** and macOS lets Kith in (the tick stays off if she says no). **Kith › Choose What Pip Sees** lists her calendars and reminder lists to tick or untick (all of them until she changes it; calendars added later aren't shared once she has chosen). The line under it says exactly what Pip sees, e.g. "Pip sees: Home, School (next 7 days) · Homework (due in the next 7 days)". The next 7 days of events and the reminders due in the next 7 days (none without a due date) go to the server every 10 minutes, and Pip sees them in its instructions. When she asks, Pip can add an event or a reminder. | Titles only, redacted like anything she types, kept for a day. Works from macOS 12: Kith asks with macOS 14's new calendar prompts where they exist and the older one otherwise. Switching it on or off shows in the activity log the parent sees. **Every addition shows a native "Add / Not now" prompt first**; the page can't skip it. At most 5 waiting. Unticking it clears the server copy. |
| **Documents** | The 📄 button in the chat composer (Mac app only), or drop a file on the window. PDF, Word, RTF, ODT, HTML, text and Markdown. | Text only, up to 12,000 characters. It goes through the same safety check and redaction as her messages. **No photos or videos**: Kith's minors policy rules out image uploads until image-safety detection is in place (docs/minors-policy.md). Pip sees the text for that turn; the chat keeps "📄 name". |
| **Call Pip** | **⌃⌥Space** from any app (or Call Pip in the menu bar or View menu) brings Kith forward and opens a call. | If another app already uses ⌃⌥Space, Kith carries on without it. |

How it fits together:

- **In the app (Rust, `mac/src-tauri/src/`):** `native.rs` holds the commands, `eventkit.rs` uses Apple's EventKit,
  and `files.rs` reads documents (PDFKit for PDFs, macOS's `textutil` for Word and the rest).
- **Who may use the commands:** only pages from the configured Kith server, in the main window. That's a Tauri
  capability added at start-up for that one origin. The sign-in provider, other sites and the desk's sandboxed frames
  get nothing. The bundled start page has its own two commands (read and save the server address) and none of these.
- **In the web app (`client/src/lib/native.ts`):** does nothing in a normal browser. In the Mac app it polls the
  notification inbox, sends the calendar snapshot, passes Pip's requests to the native prompt and handles ⌃⌥Space and
  dropped files.
- **On the server (`server/src/native.ts`):** child-only routes under `/api/native/`, the inbox that `pushToChild()`
  also writes to, the shared calendar, and Pip's `add_calendar_event` and `add_reminder` tools. The tools are offered
  only while she's sharing.

These need the server to be on the version with `server/src/native.ts`. An older server just ignores them.

## Kith and Kith Parent: one app each

There are two Mac apps, built from the same code:

| | **Kith.app** | **Kith Parent.app** |
| --- | --- | --- |
| For | the child | the grown-up |
| Name in Applications, Launchpad, Spotlight, the Dock and notifications | Kith | Kith Parent |
| Bundle id | `app.kith.mac` | `app.kith.parent` |
| Icon | Buddy | Buddy with an ember heart badge (`mac/icons-parent/`, made by `make.py` there) |
| Sign-in and settings | its own | its own |
| Extras | Calendar & Reminders, documents, ⌃⌥Space to call Pip, the child's notifications | the parent's notifications |

They install side by side, so you can keep both in the Dock.

**Each app only lets in its own person.**

- The app tells the server which one it is:
  - on sign-in, `?app=child` or `?app=parent`;
  - on its own requests, `X-Kith-App: child|parent`;
  - to the page, `window.__KITH_APP__`, which the web app uses to send the same header.
- The server refuses the other person, and a parent is never let into Kith, even if they're also in the child's group.
- If the wrong person is signed in, the app shows:
  - "This is the kids' Kith. Grown-ups use Kith Parent." (or, in Kith Parent, "This is the grown-ups' app. Kids use
    Kith."), or the server's own words when it gives them;
  - **Sign out and switch**, which signs out of Kith and of Pocket ID in the browser and clears the app's data;
  - **Open Kith Parent** (or **Open Kith**), when the other app is installed.
- The app checks who's signed in when a page loads and every 30 seconds after. It asks the server's `/api/me` with
  the window's own sign-in cookie, which stays in memory and is never logged (`mac/src-tauri/src/who.rs`).

**The parent's notifications** show as Mac notifications in Kith Parent, including with the window closed:

- The app asks the server's `/api/native/parent-inbox` every 30 seconds and shows exactly what the server would send
  the parent by web push.
- The server applies the parent's choices: which report levels, quiet hours (urgent ones still come through), and
  generic lock-screen text unless summaries are on.
- Nothing from the child's chats is ever included.
- Each poll empties the inbox page by page (the server's `last` is the last item it handed over, and `more` says another
  page is waiting). Up to 5 a minute show as they are; the rest are gathered into one "N more notifications".
- Urgent ones (`report-now`) play a sound.
- Kith.app never asks for them.

## Where links open

| Link | Opens |
| --- | --- |
| Your Kith server | In the window |
| Signing in (Pocket ID) | In your browser, then handed back to the app (below) |
| Any `signInHosts` in the config (https, or http on this Mac or the home network) | In the window |
| Anything else (Google Drive, links in chat, `mailto:`) | In your default browser |

**Signing in.** Pocket ID signs in with passkeys, and macOS only lets passkeys run in a real browser (or in an app
Apple has approved for that site). So "Sign in with Pocket ID" in the app works like this (`mac/src-tauri/src/signin.rs`):

1. The app starts a one-time handoff with the server (`POST /auth/handoff/start {"app": "child"}`, or `"parent"` in
   Kith Parent → an id and a secret, in memory only and never logged) and opens `/auth/login?handoff=<id>&app=<app>`
   in your browser, which goes on to Pocket ID. If the server gives a short code to match, the Kith window shows it.
2. The Kith window says "Finish signing in in your browser" and checks `/auth/handoff/<id>` every second and a half,
   sending the secret in the `X-Kith-Handoff-Secret` header. The id can show up in URLs and logs; the secret never
   does, so the id alone can't collect the session.
3. Once you've used your passkey, the browser shows "You're signed in". The server hands the session to the app once,
   and Kith comes back to the front.

The handoff lapses after two minutes, and the server only stores hashes of the id and secret. (A server from before
the secret answers 404 to `/auth/handoff/start`; the app then uses the older handoff with its own random id.) The polling script is only added
to the window while it's showing the Kith server itself. Nothing else loads in the window during sign-in: there's no
"anything while signing in" allowance, only the server and `signInHosts`. Pop-ups (`window.open`,
`target="_blank"`) never open a second app window: Kith pages load in the main window, and anything else goes to the
browser.

The Kith server's pages get no access to the app itself (no Tauri commands). Only the bundled start page can save the
server address.

## Setting the server address

By default the app uses a Kith server on this Mac, `http://localhost:8787` (what `docker compose up` serves). To use
another server, for example your home server over https, change it in either of these ways. No code changes are
needed:

- **At build time:** copy `mac/kith.config.example.json` to `mac/kith.config.json` and fill it in. The file is
  git-ignored. The app uses it as its default.

  ```json
  { "server": "https://ai.example.com", "signInHosts": ["auth.example.com"] }
  ```

  The example file holds the localhost default.

  `signInHosts` is optional. It lists hosts that may load in the window (sign-in itself happens in the browser, so
  most setups don't need any).

  **A build with a server baked in is locked to it.** Kith (the child's) has no Change Server… and its start page has
  no "Change server" button; it uses the baked-in server and `signInHosts` whatever the saved settings say. Kith Parent
  keeps Change Server…, but asks "Change the Kith server?" first.
- **In the app** (a build without a baked-in server, or Kith Parent): from Kith › Change Server…. This is saved in
  `~/Library/Application Support/app.kith.mac/config.json` (`app.kith.parent` for Kith Parent) and wins over the
  built-in default. The file is written to a temporary file and renamed into place, so it's never half-written; if it's
  unreadable anyway, the app falls back to the baked-in server, not to this Mac. **Changing the server restarts the
  app:** Kith's native commands are granted to the server's origin, and a grant can't be taken back while the app runs,
  so a restart is what stops the old server's pages using them.

The server must be `https://`. Plain `http://` is allowed only for this Mac (`localhost`, `*.localhost`, `127.0.0.0/8`,
`::1`) or the home network (`*.local`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, link-local, IPv6 `fc00::/7`).
The address is parsed as an IP, so look-alikes such as `10.example.com` don't count. Handy for development, e.g.
`http://localhost:8787`.

Sign-in follows the server. A local dev server with `KITH_DEV_LOGIN=true` shows its "Try as…" buttons, and a server
with Pocket ID sends you to Pocket ID inside the window. The app never turns dev sign-in on itself.

## Build

You need [Rust](https://rustup.rs) and Xcode's command line tools (`xcode-select --install`). Install the Tauri CLI
once:

```bash
cargo install tauri-cli --version "^2" --locked
```

Then build both apps:

```bash
mac/build-all.sh
```

If Rust can build for both kinds of Mac (`rustup target add aarch64-apple-darwin x86_64-apple-darwin`), the apps are
universal (Apple silicon and Intel, `--target universal-apple-darwin`); otherwise they're for the Mac you're on, and the
script says so. `KITH_UNIVERSAL=0` always builds for this Mac; `KITH_UNIVERSAL=1` insists on universal.

This puts all four files in `mac/dist/` (git-ignored):

- `Kith.app` and `Kith.dmg`;
- `Kith Parent.app` and `Kith Parent.dmg`.

It runs `cargo tauri build` twice, the second time with `--config tauri.parent.conf.json` (the parent build's name, id
and icon). It copies each result out, because Tauri empties its `dmg` folder on every build. `CI=true` skips the
Finder window the `.dmg` step would otherwise open.

The `.dmg` files are styled installers: a background saying "Drag Kith into Applications", the app on the left, an
arrow, and Applications on the right. `mac/installer/make-dmgs.sh` makes them with
[dmgbuild](https://pypi.org/project/dmgbuild/) (`pip install dmgbuild`, or set `DMGBUILD` to its path). dmgbuild
writes the window layout directly instead of through Finder, so it looks the same whatever the building Mac's Finder
settings are (for example "Use Groups"). Without dmgbuild, you get Tauri's plain `Kith_0.1.0_aarch64.dmg` files instead.
The backgrounds are `mac/installer/bg-*.svg`, rendered to `bg-*.tiff` at 1x and 2x.

To build just one app without the `.dmg`, run this from `mac/src-tauri`:

- Kith: `cargo tauri build --bundles app`
- Kith Parent: `cargo tauri build --bundles app --config tauri.parent.conf.json`

For a quick run while working on the shell, use `cargo tauri dev` from the same folder. To see where each page goes
(window or browser), start the app with `KITH_DEBUG=1`. It logs origins only, never paths or query strings, since
sign-in URLs carry one-time codes and handoff ids:

```bash
open -n --env KITH_DEBUG=1 --stderr /tmp/kith.log mac/src-tauri/target/release/bundle/macos/Kith.app
```

## Install

Open each `.dmg` and drag the app to Applications: **Kith** for the child, **Kith Parent** for you. They have different
names and bundle ids, so one never replaces the other. On the child's Mac you only need Kith.

The builds aren't signed, so the first time macOS says it can't check the app:

1. Open it once (it'll be blocked).
2. Go to System Settings › Privacy & Security and choose **Open Anyway**.

Or, for apps you built yourself on this Mac, clear the download flag instead:

```bash
xattr -dr com.apple.quarantine /Applications/Kith.app "/Applications/Kith Parent.app"
```

A build made on the same Mac and never downloaded usually opens without either step.

## Signing and notarising (Developer ID)

Nothing here is set up yet: there's no Apple Developer account. When there is, this is how to ship Kith so it opens
without the "can't check the app" warning, outside the App Store.

**Once:**

1. Join the Apple Developer Program (paid, yearly) as the person or organisation who'll publish Kith.
2. In Xcode › Settings › Accounts, or at developer.apple.com › Certificates, create a **Developer ID Application**
   certificate. Keep it in the login keychain of the Mac that builds. Check it's there:
   `security find-identity -v -p codesigning` lists `Developer ID Application: Your Name (TEAMID)`.
3. Make an app-specific password at account.apple.com › Sign-In and Security (for `notarytool`), or, better for
   automation, an App Store Connect API key (Users and Access › Integrations › Keys).

**Each build:**

1. Sign: set `APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"` in the environment (or
   `bundle.macOS.signingIdentity` in `mac/src-tauri/tauri.conf.json`). Tauri signs with the hardened runtime and
   `mac/src-tauri/Entitlements.plist` (microphone, calendars, reminders and network are already there).
2. Notarise: also set `APPLE_ID`, `APPLE_PASSWORD` (the app-specific password) and `APPLE_TEAM_ID`, or for an API key
   `APPLE_API_ISSUER`, `APPLE_API_KEY` and `APPLE_API_KEY_PATH`. Type secrets at a hidden prompt
   (`read -s APPLE_PASSWORD; export APPLE_PASSWORD`); never put them in a file in the repo. Then `mac/build-all.sh` as
   usual: Tauri uploads each app to Apple's notary service, waits, and staples the ticket to the `.app`.
3. The styled `.dmg` (`mac/installer/make-dmgs.sh`) is made after Tauri's step, so sign and notarise it too:

   ```bash
   codesign --sign "$APPLE_SIGNING_IDENTITY" --timestamp mac/dist/Kith.dmg
   xcrun notarytool submit mac/dist/Kith.dmg --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_PASSWORD" --wait
   xcrun stapler staple mac/dist/Kith.dmg
   ```

   (and the same for `Kith Parent.dmg`).
4. Check: `spctl -a -vvv -t install mac/dist/Kith.dmg` and `spctl -a -vvv /path/to/Kith.app` should say
   "accepted, source=Notarized Developer ID".

With signing, urgent parent notifications could also use "Time Sensitive" (it needs Apple's entitlement as well).

## Updates

The app can update itself with Tauri's updater (`mac/src-tauri/src/updater.rs`). It's **off** unless
`mac/kith.config.json` has both of these when you build:

```json
{ "server": "https://ai.example.com", "updateUrl": "https://example.com/kith/{app}/latest.json", "updatePublicKey": "dW50cnVzdGVkIGNvbW1lbnQ6…" }
```

Then a minute after it starts, and once a day, the app reads `updateUrl` (https only). If there's a newer version it
asks "Install it now?", downloads it, checks its signature against `updatePublicKey` (an update not signed with the
matching private key is refused) and restarts.

To publish updates:

1. Once: `cargo tauri signer generate -w ~/.tauri/kith.key`. Keep the private key and its password out of the repo;
   the public key goes in `updatePublicKey`.
2. Build with `TAURI_SIGNING_PRIVATE_KEY` (the key file's contents or path) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` set,
   and `bundle.createUpdaterArtifacts: true` in `tauri.conf.json`. That adds `Kith.app.tar.gz` and its `.sig` next to
   the app.
3. Upload the `.tar.gz` and serve a `latest.json` at `updateUrl`:
   `{ "version": "0.2.0", "notes": "…", "pub_date": "2026-12-01T00:00:00Z", "platforms": { "darwin-aarch64": { "url": "https://…/Kith.app.tar.gz", "signature": "<contents of the .sig>" }, "darwin-x86_64": { … } } }`.
   Both apps are built from the same config, so `{app}` in `updateUrl` becomes `child` in Kith and `parent` in Kith
   Parent: each gets its own `latest.json` and archive.

Updates replace the app in place. Unsigned ones still install, but once Kith is shared beyond this family, sign and
notarise each update too (above).

## Not done yet

- **Notifications arrive within about 30 seconds,** not instantly: the app polls (web push can't reach an app's web
  view). If she quits Kith from the menu bar, none arrive until she opens it again. Clicking a notification opens Kith
  but not a particular screen.
- **Photos.** Left out on purpose until image-safety detection is added (see the minors policy).
- **Parent view of the shared calendar.** The parent sees when sharing is switched on or off, not the events.
- **"Time Sensitive" notifications.** macOS only allows these for signed apps with Apple's entitlement, so urgent
  parent notifications use a sound instead. With signing, they could break through Focus.
- **Signing and notarising** (see above): needs an Apple Developer account.
- **Updates** are wired but off (see above): no update address or signing key yet.

## The other way: bundle the client

You could instead bundle `client/dist` in the app and point it at the server's API
(`VITE_KITH_API=https://ai.example.com npm run build -w client`). That needs CORS for the app's origin and cookies with
`SameSite=None; Secure` on the server. The live-server window above avoids all of that, so it's what `mac/` does.

## Icons

The app icon ("Buddy") is exported for every platform in `design/icon/icons/`:

- `desktop/icon.icns`: the Mac app's icon. `mac/src-tauri/icons/` holds RGBA PNGs made from `desktop/icon-1024.png`
  for the window icon (Tauri needs RGBA).
- `apple/`: Icon Composer layers for the macOS 26 Liquid Glass icon.
- `menubar/`: a template glyph for a menu-bar item.

The web app already uses the `web/` set (favicon, apple-touch-icon, PWA icons).
