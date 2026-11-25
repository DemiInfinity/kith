# The Mac app (later)

The web app already has the Mac layout from the design:

- a sidebar with the avatar, mood, energy bar and sections;
- chat in the middle;
- the companion's desk on the right, "live from home".

It switches to that layout at 1100px wide or more. Open it in Safari and use File › Add to Dock for an app-like window
today.

## Wrapping it with Tauri

The client is a static Vite build, so a thin [Tauri](https://tauri.app) shell works without changing the app.
There are two ways to do it. The first is recommended.

### Option 1: point the window at your Kith server

This keeps sign-in, cookies and the sandboxed desk frames exactly as they are on the web. Recommended.

```bash
npm create tauri-app@latest kith-mac -- --template vanilla
```

In `src-tauri/tauri.conf.json`, set the window's `url` to your server (e.g. `https://ai.example.com`). Set the window
size to around 1500×920 and the title to "Kith".

Allow microphone use. Add `NSMicrophoneUsageDescription` to `Info.plist`, for example: "Kith listens when you tap the
mic during a call."

### Option 2: bundle the client

1. **Build the client** with the server's address: `VITE_KITH_API=https://ai.example.com npm run build -w client`.
2. **Point Tauri's `frontendDist`** at `client/dist`.
3. **Change the server** so the app's origin is allowed:
   - Cross-origin requests (CORS) need allowing for the app's origin.
   - Cookies need `SameSite=None; Secure`.

Option 1 avoids all of this.

## Icons

The app icon ("Buddy") is exported for every platform in `design/icon/icons/`:

- `desktop/icon.icns`, `icon.ico` and PNGs: Tauri's `bundle.icon`.
- `apple/`: Icon Composer layers for the macOS 26 Liquid Glass icon.
- `menubar/`: a template glyph for a menu-bar item.

The web app already uses the `web/` set (favicon, apple-touch-icon, PWA icons).

## Not done yet

- **Push notifications on macOS**: Safari web push works for an added-to-Dock app; Tauri would need its own
  notification plugin.
- **Signing and notarising** the app.
