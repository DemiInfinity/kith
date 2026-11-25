// Signing in from an installed web app (Safari "Add to Dock", or an iPhone Home Screen app).
// The sign-in provider is outside the app, so the system opens it in a separate window, and that
// window may not share cookies with the app. The app opens /auth/login?handoff=<random id> in a
// window and polls /auth/handoff/<id>; the server hands over the session once (the poll sets the
// cookie in the app's own context). In a normal browser tab, sign-in is unchanged.

import { withApp } from "./appHint";

export function isInstalledApp(): boolean {
  try {
    return window.matchMedia("(display-mode: standalone)").matches
      || window.matchMedia("(display-mode: fullscreen)").matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

export function newHandoffId(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type HandoffResult = { ok: true; redirect: string } | { ok: false; error: string };

/** Polls until the sign-in window finishes (or about 2.5 minutes pass, or `signal` aborts). */
export async function waitForHandoff(id: string, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<HandoffResult> {
  const until = Date.now() + 150_000;
  while (Date.now() < until && !signal.aborted) {
    await new Promise((r) => setTimeout(r, 1500));
    if (signal.aborted) break;
    if (document.visibilityState === "hidden") continue; // iOS pauses us while Safari is in front; carry on when back
    try {
      const r = await fetchImpl(`/auth/handoff/${id}`, { credentials: "same-origin", cache: "no-store" });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; pending?: boolean; redirect?: string; error?: string };
      if (r.ok && j.ok) return { ok: true, redirect: j.redirect ?? "/" };
      if (r.ok && j.pending) continue;
      if (r.status === 429) continue;
      return { ok: false, error: j.error ?? "failed" };
    } catch {
      /* offline for a moment: keep trying */
    }
  }
  return { ok: false, error: signal.aborted ? "cancelled" : "expired" };
}

/** A handoff got ready before the click: its id and the provider's sign-in address. */
export type PreparedSignIn = { id: string; url: string; at: number };

/**
 * Asks the server for the provider's address ahead of time, so the click can open it at once:
 * Safari blocks windows opened after a wait, and only a page outside the app (the provider's)
 * opens in the browser rather than in a popup inside the installed app. `null` if the server
 * can't (an older one redirects instead, and this fetch fails).
 */
export async function prepareSignIn(fetchImpl: typeof fetch = fetch): Promise<PreparedSignIn | null> {
  const id = newHandoffId();
  try {
    const r = await fetchImpl(withApp(`/auth/login?handoff=${id}&json=1`), { credentials: "same-origin", cache: "no-store" });
    if (!r.ok) return null;
    const j = (await r.json()) as { url?: unknown };
    return typeof j.url === "string" && /^https?:\/\//.test(j.url) ? { id, url: j.url, at: Date.now() } : null;
  } catch {
    return null;
  }
}

/** The server keeps a sign-in's state for 15 minutes; use a prepared one for 10. */
export const preparedFresh = (p: PreparedSignIn | null, now = Date.now()): p is PreparedSignIn => p !== null && now - p.at < 10 * 60_000;
