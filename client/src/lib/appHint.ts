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

/** What to say when someone signs in to the wrong app (before there's a session, so no names). */
export function wrongAppWords(code: string): string | null {
  if (code === "use-parent-app") return "This app is for the child. Grown-ups use Kith Parent.";
  if (code === "use-child-app") return "This is the grown-up’s app. The child uses Kith.";
  return null;
}
