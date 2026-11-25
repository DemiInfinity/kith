# The Mac app

`mac/` is Kith for the Mac: a small [Tauri 2](https://tauri.app) app, written in Rust, whose window shows your own Kith
server. It looks and works exactly like the web app's desktop layout:

- a sidebar with the avatar, mood, energy bar and sections;
- chat in the middle;
- the companion's desk on the right, "live from home".

The web app switches to that layout at 1100px wide or more, so the window never gets narrower than that.

Because the window loads the live server, sign-in, cookies, the sandboxed desk frames and every future change to the web
app are the same in the Mac app, with nothing to rebuild. There's no second UI to maintain.

## What the app adds

- **A proper Mac window:** about 1500×920 the first time, then it remembers its size and position. The title bar blends
  into Kith's plum background (`#1C1219`) and the title is hidden.
- **The Buddy icon** from `design/icon/icons/desktop/icon.icns`.
- **⌘R reloads.** View › Reload goes through the start page, so if home can't be reached you get the friendly screen,
  not a blank window.
- **A start page** (`mac/launcher/`, bundled in the app):
  - On first launch, if no server is set, it asks for the address.
  - On every launch and reload it checks the server answers before showing it.
  - If home can't be reached it says so, with "Try again". It also tries again by itself every 15 seconds and when the
    Mac comes back online.
  - Kith › Change Server… brings the address form back.
- **The microphone** for voice calls. macOS asks once, with "Kith listens when you tap the mic during a call."
- **The usual Mac menus:** Edit (copy, paste, undo), View, Window and Kith › Quit.

## Where links open

| Link | Opens |
| --- | --- |
| Your Kith server | In the window |
| Sign-in: everything after `<server>/auth/login` until you're back on the server, plus any `signInHosts` in the config | In the window |
| Anything else (Google Drive, links in chat, `mailto:`) | In your default browser |

Sign-in stays in the window on purpose. If Pocket ID (or another provider) opened in Safari, the sign-in cookie would
land in Safari, not in the app. Pop-ups (`window.open`, `target="_blank"`) never open a second app window: Kith pages
load in the main window, and anything else goes to the browser.

The Kith server's pages get no access to the app itself (no Tauri commands). Only the bundled start page can save the
server address.

## Setting the server address

Kith is open source, so the address isn't in the code. Use either or both of these:

- **At build time:** copy `mac/kith.config.example.json` to `mac/kith.config.json` and fill it in. The file is
  git-ignored. The app uses it as its default.

  ```json
  { "server": "https://ai.example.com", "signInHosts": ["auth.example.com"] }
  ```

  `signInHosts` is optional. It lists sign-in hosts that may always load in the window. Without it, sign-in still works:
  the provider is allowed while a sign-in is in progress.
- **In the app:** on first launch, or from Kith › Change Server…. This is saved in
  `~/Library/Application Support/app.kith.mac/config.json` and wins over the built-in default.

The server must be `https://`. Plain `http://` is allowed only for this Mac (`localhost`) or the local network, which is
handy for development, e.g. `http://localhost:8787`.

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

`mac/src-tauri/Entitlements.plist` already has the microphone and network entitlements the hardened runtime needs.

## Not done yet

- **Notifications.** The app's web view (WKWebView, embedded in an app) doesn't support web push or the web
  Notifications API: those are Safari-only, including Safari's Add to Dock apps. Kith's in-app updates still show while
  the window is open. To get Mac notifications, the server's pages would need a small bridge to Tauri's notification
  plugin, which means giving the remote site access to the app. Left out for now on purpose.
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
