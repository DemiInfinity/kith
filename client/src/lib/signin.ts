// Signing in from an installed web app (Safari "Add to Dock", or an iPhone Home Screen app).
// The sign-in provider is outside the app, so the system opens it in a separate window, and that
// window may not share cookies with the app. The app starts a handoff (POST /auth/handoff/start →
// an id and a secret), opens /auth/login?handoff=<id> in a window, and polls /auth/handoff/<id>
// with the secret in a header; the server hands over the session once (the poll sets the cookie in
// the app's own context). In a normal browser tab, sign-in is unchanged.

import { appHint, withApp } from "./appHint";

export function isInstalledApp(): boolean {
  try {
    return window.matchMedia("(display-mode: standalone)").matches
      || window.matchMedia("(display-mode: fullscreen)").matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

/** A handoff the server started: the id goes in the sign-in URL; the secret stays in memory only
 *  (never in storage or a URL) and goes in a header on each poll, so knowing the id isn't enough. */
export type Handoff = { id: string; secret: string; at: number; expiresAt: number };

const B64URL = /^[A-Za-z0-9_-]{43}$/;

/** POST /auth/handoff/start. `null` if the server can't (offline, rate-limited, or an older server). */
export async function startHandoff(app: string | null, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<Handoff | null> {
  try {
    const r = await fetchImpl("/auth/handoff/start", {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json", "X-Kith": "1" },
      body: JSON.stringify(app ? { app } : {}),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { id?: unknown; secret?: unknown; expiresIn?: unknown };
    if (typeof j.id !== "string" || typeof j.secret !== "string" || !B64URL.test(j.id) || !B64URL.test(j.secret)) return null;
    const life = typeof j.expiresIn === "number" && j.expiresIn > 0 ? Math.min(j.expiresIn, 900) : 900;
    return { id: j.id, secret: j.secret, at: now, expiresAt: now + life * 1000 };
  } catch {
    return null;
  }
}

export type HandoffResult = { ok: true; redirect: string } | { ok: false; error: string };

/** Polls until the sign-in window finishes (or the handoff expires, or `signal` aborts). */
export async function waitForHandoff(h: Pick<Handoff, "id" | "secret" | "expiresAt">, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<HandoffResult> {
  while (Date.now() < h.expiresAt && !signal.aborted) {
    await new Promise((r) => setTimeout(r, 1500));
    if (signal.aborted) break;
    if (document.visibilityState === "hidden") continue; // iOS pauses us while Safari is in front; carry on when back
    try {
      const r = await fetchImpl(`/auth/handoff/${h.id}`, { credentials: "same-origin", cache: "no-store", headers: { "X-Kith-Handoff-Secret": h.secret } });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; pending?: boolean; redirect?: string; error?: string };
      if (r.ok && j.ok) return { ok: true, redirect: j.redirect ?? "/" };
      if (r.ok && j.pending) continue;
      if (r.status === 429 || r.status >= 500) continue; // busy, or home blinked: keep trying
      if (r.status === 410) return { ok: false, error: "expired" };
      return { ok: false, error: j.error ?? "failed" };
    } catch {
      /* offline for a moment: keep trying */
    }
  }
  return { ok: false, error: signal.aborted ? "cancelled" : "expired" };
}

/** What to tell someone when a handoff didn't finish. */
export function handoffWords(error: string, wrongApp: (code: string) => string | null): string {
  if (error === "expired" || error === "unknown handoff") return "Sign-in timed out. Try again?";
  if (error === "not-allowed") return "That account isn’t set up for Kith. Ask the grown-up who runs it.";
  const wrong = wrongApp(error);
  if (wrong) return wrong;
  // A refusal reason the server worded for people (not a short code) is shown as it is.
  if (/\s/.test(error) && error !== "bad handoff secret" && error !== "bad app") return error;
  return "Sign-in didn’t finish. Try again?";
}

/** A handoff got ready before the click: the started handoff and the provider's sign-in address. */
export type PreparedSignIn = Handoff & { url: string };

/**
 * Starts a handoff and asks the server for the provider's address ahead of time, so the click can
 * open it at once: Safari blocks windows opened after a wait, and only a page outside the app (the
 * provider's) opens in the browser rather than in a popup inside the installed app. `null` if the
 * server can't.
 */
export async function prepareSignIn(fetchImpl: typeof fetch = fetch): Promise<PreparedSignIn | null> {
  const app = appHint();
  const h = await startHandoff(app, fetchImpl);
  if (!h) return null;
  try {
    const r = await fetchImpl(withApp(`/auth/login?handoff=${h.id}&json=1`), { credentials: "same-origin", cache: "no-store" });
    if (!r.ok) return null;
    const j = (await r.json()) as { url?: unknown };
    return typeof j.url === "string" && /^https?:\/\//.test(j.url) ? { ...h, url: j.url } : null;
  } catch {
    return null;
  }
}

/** The server keeps a started handoff for 15 minutes; use a prepared one for 10. */
export const preparedFresh = (p: PreparedSignIn | null, now = Date.now()): p is PreparedSignIn => p !== null && now - p.at < 10 * 60_000 && now < p.expiresAt - 60_000;
