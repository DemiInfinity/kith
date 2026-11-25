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
  - Kith › Change Server… brings the address form back.
- **The microphone** for voice calls. macOS asks once, with "Kith listens when you tap the mic during a call."
- **The usual Mac menus:** Edit (copy, paste, undo), View, Window and Kith › Quit.
- **The menu bar:** closing the window keeps Kith running in the menu bar (Open Kith, Call Pip, Quit Kith), so
  notifications still arrive. Clicking Kith in the Dock brings the window back.

## Pip and the Mac

Each of these asks the child the first time (macOS's own prompts) and can be switched off again in System Settings ›
Privacy & Security.

| What | How it works | Safeguards |
| --- | --- | --- |
| **Notifications** | Pip's check-ins, reminders and "your thing is ready" show as Mac notifications, even with the window closed. The page polls the server every 30 seconds. | Same choices as on her phone (Settings › Notifications). At most 6 a minute. |
| **Calendar & Reminders** | Off until she ticks **Kith › Share Calendar & Reminders with Pip**. Then the coming week's events and her open to-dos go to the server every 10 minutes, and Pip sees them in its instructions. When she asks, Pip can add an event or a reminder. | Titles only, redacted like anything she types, kept for a day. Switching it on or off shows in the activity log the parent sees. **Every addition shows a native "Add / Not now" prompt first**; the page can't skip it. At most 5 waiting. Unticking it clears the server copy. |
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

## Where links open

| Link | Opens |
| --- | --- |
| Your Kith server | In the window |
| Signing in (Pocket ID) | In your browser, then handed back to the app (below) |
| Signing out of the provider, and any `signInHosts` in the config | In the window |
| Anything else (Google Drive, links in chat, `mailto:`) | In your default browser |

**Signing in.** Pocket ID signs in with passkeys, and macOS only lets passkeys run in a real browser (or in an app
Apple has approved for that site). So "Sign in with Pocket ID" in the app works like this (`mac/src-tauri/src/signin.rs`):

1. The app starts a one-time handoff with the server (`/auth/login?handoff=<random id>`) and opens Pocket ID's page in
   your browser.
2. The Kith window says "Finish signing in in your browser" and checks `/auth/handoff/<id>` every second and a half.
3. Once you've used your passkey, the browser shows "You're signed in". The server hands the session to the app once,
   and Kith comes back to the front.

The handoff lapses after two minutes, and the server only stores a hash of the id. Pop-ups (`window.open`,
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

  `signInHosts` is optional. It lists sign-in hosts that may always load in the window. Without it, sign-in still works:
  the provider is allowed while a sign-in is in progress.
- **In the app:** from Kith › Change Server…. This is saved in
  `~/Library/Application Support/app.kith.mac/config.json` and wins over the built-in default.

The server must be `https://`. Plain `http://` is allowed only for this Mac (`localhost`) or the local network, which is
handy for development, e.g. `http://localhost:8787`.

Sign-in follows the server. A local dev server with `KITH_DEV_LOGIN=true` shows its "Try as…" buttons, and a server
with Pocket ID sends you to Pocket ID inside the window. The app never turns dev sign-in on itself.

## Build

You need [Rust](https://rustup.rs) and Xcode's command line tools (`xcode-select --install`). Install the Tauri CLI
once:

```bash
cargo install tauri-cli --version "^2" --locked
```

Then build:

```bash
cd mac/src-tauri
cargo tauri build
```

The output is:

- `mac/src-tauri/target/release/bundle/macos/Kith.app`;
- `mac/src-tauri/target/release/bundle/dmg/Kith_0.1.0_aarch64.dmg`.

Building the `.dmg` briefly mounts it and opens a Finder window to lay it out. For just the app, use
`cargo tauri build --bundles app`.

For a quick run while working on the shell, use `cargo tauri dev` from the same folder. To see where each page goes
(window or browser), start the app with `KITH_DEBUG=1`. It logs origins and paths only, never query strings, since
sign-in URLs carry one-time codes:

```bash
open -n --env KITH_DEBUG=1 --stderr /tmp/kith.log mac/src-tauri/target/release/bundle/macos/Kith.app
```

## Install

Open the `.dmg` and drag Kith to Applications.

The build isn't signed, so the first time macOS says it can't check the app:

1. Open it once (it'll be blocked).
2. Go to System Settings › Privacy & Security and choose **Open Anyway** next to Kith.

Or, for an app you built yourself on this Mac, clear the download flag instead:

```bash
xattr -dr com.apple.quarantine /Applications/Kith.app
```

A build made on the same Mac and never downloaded usually opens without either step.

## Signing and notarising later

To share the app without the warning you need an Apple Developer account (paid) and a "Developer ID Application"
certificate in your keychain. Then:

1. Set `bundle.macOS.signingIdentity` in `mac/src-tauri/tauri.conf.json` to the certificate's name, e.g.
   `"Developer ID Application: Your Name (TEAMID)"`. Or set `APPLE_SIGNING_IDENTITY` when building.
2. For notarising, set `APPLE_ID`, `APPLE_PASSWORD` (an app-specific password) and `APPLE_TEAM_ID` in the environment
   before `cargo tauri build`. Type the password at a hidden prompt (`read -s APPLE_PASSWORD; export APPLE_PASSWORD`);
   don't put it in a file in the repo.

`mac/src-tauri/Entitlements.plist` already has the microphone, calendars and network entitlements the hardened runtime
needs.

## Not done yet

- **Notifications arrive within about 30 seconds,** not instantly: the app polls (web push can't reach an app's web
  view). If she quits Kith from the menu bar, none arrive until she opens it again. Clicking a notification opens Kith
  but not a particular screen.
- **Photos.** Left out on purpose until image-safety detection is added (see the minors policy).
- **Parent view of the shared calendar.** The parent sees when sharing is switched on or off, not the events.
- **Signing and notarising** (see above).
- **Universal build.** `cargo tauri build` builds for the Mac you're on. For Intel and Apple silicon in one app, add
  the other target (`rustup target add x86_64-apple-darwin`) and build with `--target universal-apple-darwin`.

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
