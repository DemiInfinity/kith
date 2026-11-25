import { useEffect, useState } from "react";
import { api, type Me } from "../api";

export interface GoogleStatus { configured: boolean; connected: boolean; email: string; enabled: boolean; sharedWith: string; picker: boolean; expected: string }

/** Connect the child's own Google Drive (once). Kith only sees files it made, or ones they hand it. */
export function Google({ me, isParent = false }: { me: Me; isParent?: boolean }) {
  const [s, setS] = useState<GoogleStatus | null>(null);
  const [msg, setMsg] = useState("");
  const result = new URLSearchParams(location.search).get("result");
  const why = new URLSearchParams(location.search).get("why");
  const load = () => api<GoogleStatus>("/api/google").then(setS).catch(() => undefined);
  useEffect(() => { void load(); }, []);
  const name = me.profile.name;

  const connect = async () => {
    try { location.href = (await api<{ url: string }>("/api/google/connect", { body: {} })).url; } catch (e) { setMsg((e as Error).message); }
  };
  const disconnect = async () => {
    if (!confirm("Disconnect Google? Files already in Drive stay there.")) return;
    await api("/api/google/disconnect", { body: {} });
    void load();
  };

  return (
    <div className="screen narrow">
      <span className="hand">your files, your Drive</span>
      <h2 className="screen-title">Google Drive</h2>
      {result === "connected" && <div className="notice">Connected ✓ Things {name} makes will be saved to a “Kith” folder in your Drive.</div>}
      {result === "failed" && <div className="notice">That didn’t connect{why ? `: ${why}` : "."}</div>}
      {result === "cancelled" && <div className="notice">No problem, nothing was connected.</div>}
      {s && !s.configured && <div className="card"><b>Not set up yet</b><span className="small">{me.parentLabel} needs to add a Google sign-in for Kith first (docs/google.md).</span></div>}
      {s?.configured && (
        <div className="card" style={{ gap: 10 }}>
          <span className="spread"><b>{s.connected ? `Connected: ${s.email}` : "Not connected"}</b><span className="small">{s.enabled ? "switched on" : `${me.parentLabel} hasn’t switched it on`}</span></span>
          <span style={{ fontSize: 14, color: "var(--text-3)" }}>
            {name} keeps everything on its desk at home anyway. With Google connected, it also saves what it makes into a <b>Kith</b> folder in your Drive
            (Stories, Revision, Presentations, Games &amp; artifacts, OCs): stories as Docs, flashcards as Sheets too, presentations as Slides.
          </span>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, color: "var(--text-3)" }}>
            <li>{name} can only see files it made, or a doc you choose to hand it. Never the rest of your Drive, Gmail or Photos.</li>
            <li>It never deletes or overwrites your files: changes are saved as new versions alongside.</li>
            <li>It never shares anything with anyone{s.sharedWith ? `, except the Kith folder, view-only, with ${me.parentLabel} (${s.sharedWith})` : ""}. Sharing your own files is up to you.</li>
            <li>Every save is listed in “What {me.parentLabel} sees”.</li>
          </ul>
          {!isParent && !s.connected && <button className="btn primary" onClick={connect}>Connect my Google account</button>}
          {s.connected && <button className="btn ghost small" onClick={disconnect}>Disconnect</button>}
          {!isParent && !s.connected && <span className="small">If your Google account is supervised with Family Link, {me.parentLabel} may need to approve Kith.</span>}
        </div>
      )}
      {msg && <span className="small" style={{ color: "var(--ember)" }}>{msg}</span>}
    </div>
  );
}

// ── Google Picker: hand Kith one Google Doc (drive.file) ────────────────────────────────────

declare global {
  interface Window {
    gapi?: { load: (lib: string, cb: () => void) => void };
    google?: { picker: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  }
}

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Couldn't load the Google Picker."));
    document.head.appendChild(s);
  });
}

/** Opens Google's file picker and returns the text of the doc they choose (or null if cancelled). */
export async function pickGoogleDoc(): Promise<{ text: string; name: string } | null> {
  const cfg = await api<{ token: string; apiKey: string; appId: string }>("/api/google/picker");
  await loadScript("https://apis.google.com/js/api.js");
  await new Promise<void>((r) => window.gapi!.load("picker", () => r()));
  const P = window.google!.picker;
  const picked = await new Promise<{ id: string; name: string } | null>((resolve) => {
    const view = new P.DocsView(P.ViewId.DOCUMENTS).setMimeTypes("application/vnd.google-apps.document");
    new P.PickerBuilder()
      .addView(view).setOAuthToken(cfg.token).setDeveloperKey(cfg.apiKey).setAppId(cfg.appId)
      .setCallback((d: { action: string; docs?: { id: string; name: string }[] }) => {
        if (d.action === P.Action.PICKED && d.docs?.[0]) resolve({ id: d.docs[0].id, name: d.docs[0].name });
        if (d.action === P.Action.CANCEL) resolve(null);
      })
      .build().setVisible(true);
  });
  if (!picked) return null;
  const { text } = await api<{ text: string }>("/api/google/read-picked", { body: { fileId: picked.id } });
  return { text, name: picked.name };
}
