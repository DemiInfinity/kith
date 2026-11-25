// Signing in from an installed web app (Safari "Add to Dock", or an iPhone Home Screen app).
// The sign-in provider is outside the app, so the system opens it in a separate window, and that
// window may not share cookies with the app. The app opens /auth/login?handoff=<random id> in a
// window and polls /auth/handoff/<id>; the server hands over the session once (the poll sets the
// cookie in the app's own context). In a normal browser tab, sign-in is unchanged.

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
