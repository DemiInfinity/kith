// Which app this is, for installed web apps: the Dock or Home Screen app opens at /?app=child or
// /?app=parent (from the manifest), and remembers it in its own storage. Requests then carry
// X-Kith-App, and sign-in carries ?app=, so each app only lets in its own person. In a normal
// browser tab there's no hint and everything works as before.

import { isInstalledApp } from "./signin";

export type AppHint = "child" | "parent";
const KEY = "kith-app";
let cached: AppHint | null | undefined;

export function appHint(): AppHint | null {
  if (cached !== undefined) return cached;
  cached = null;
  // The Mac apps (Kith.app, Kith Parent.app) aren't display-mode standalone, so they say which
  // one they are before the page runs. A hint only ever narrows who gets in, never grants access.
  const native = (globalThis as { __KITH_APP__?: unknown }).__KITH_APP__;
  if (native === "child" || native === "parent") { cached = native; return cached; }
  try {
    if (!isInstalledApp()) return cached;
    const fromUrl = new URLSearchParams(location.search).get("app");
    if (fromUrl === "child" || fromUrl === "parent") { localStorage.setItem(KEY, fromUrl); cached = fromUrl; return cached; }
    const saved = localStorage.getItem(KEY);
    cached = saved === "child" || saved === "parent" ? saved : null;
  } catch { /* no storage: no hint */ }
  return cached;
}

/** Adds ?app= (or &app=) when this app has a hint. */
export function withApp(url: string): string {
  const h = appHint();
  return h ? `${url}${url.includes("?") ? "&" : "?"}app=${h}` : url;
}

/** What to say when someone signs in to the wrong app (same words as the server’s 403). */
export function wrongAppWords(code: string): string | null {
  if (code === "use-parent-app") return "This is the kids’ Kith. Grown-ups use Kith Parent.";
  if (code === "use-child-app") return "This is the grown-ups’ app. Kids use Kith.";
  return null;
}
