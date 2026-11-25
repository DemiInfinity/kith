import { useEffect, useState } from "react";
import { api, type GooglePending, type Me } from "../api";
import { ConfirmCard } from "../components/ConfirmCard";

export interface GoogleStatus {
  configured: boolean; connected: boolean; email: string; enabled: boolean; sharedWith: string; picker: boolean; expected: string;
  features?: { edit: boolean; calendar: boolean; tasks: boolean }; reconnect?: boolean;
}
interface KnownFile { id: string; name: string; mime: string; source: "created" | "picked"; coursework: number }
const KIND_NAME: Record<string, string> = { "application/vnd.google-apps.document": "Doc", "application/vnd.google-apps.spreadsheet": "Sheet", "application/vnd.google-apps.presentation": "Slides" };

/** Connect the child's own Google account (once). Kith only sees files it made, or ones they hand it. */
export function Google({ me, isParent = false }: { me: Me; isParent?: boolean }) {
  const [s, setS] = useState<GoogleStatus | null>(null);
  const [files, setFiles] = useState<KnownFile[]>([]);
  const [pending, setPending] = useState<GooglePending[]>([]);
  const [msg, setMsg] = useState("");
  const result = new URLSearchParams(location.search).get("result");
  const why = new URLSearchParams(location.search).get("why");
  const load = () => {
    api<GoogleStatus>("/api/google").then(setS).catch(() => undefined);
    api<{ files: KnownFile[] }>("/api/google/files").then((r) => setFiles(r.files)).catch(() => undefined);
    if (!isParent) api<{ pending: GooglePending[] }>("/api/google/pending").then((r) => setPending(r.pending)).catch(() => undefined);
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const name = me.profile.name;
  const f = s?.features;

  const connect = async () => {
    try { location.href = (await api<{ url: string }>("/api/google/connect", { body: {} })).url; } catch (e) { setMsg((e as Error).message); }
  };
  const disconnect = async () => {
    if (!confirm("Disconnect Google? Files already in Drive stay there.")) return;
    await api("/api/google/disconnect", { body: {} });
    load();
  };
  const pick = async (coursework: boolean) => {
    setMsg("");
    try {
      const p = await pickGoogleFile();
      if (!p) return;
      await api("/api/google/picked", { body: { fileId: p.id, name: p.name, mimeType: p.mimeType, coursework } });
      setMsg(coursework ? `${name} can read “${p.name}” and help you with it, but won’t edit it (coursework).` : `${name} can now open “${p.name}”.`);
      load();
    } catch (e) { setMsg((e as Error).message); }
  };
  const markCoursework = async (id: string, on: boolean) => {
    try { await api(`/api/google/files/${id}/coursework`, { body: { coursework: on } }); load(); } catch (e) { setMsg((e as Error).message); }
  };

  return (
    <div className="screen narrow">
      <span className="hand">your files, your Drive</span>
      <h2 className="screen-title">Google</h2>
      {result === "connected" && <div className="notice">Connected. Things {name} makes will be saved to a “Kith” folder in your Drive.</div>}
      {result === "failed" && <div className="notice">That didn’t connect{why ? `: ${why}` : "."}</div>}
      {result === "cancelled" && <div className="notice">No problem, nothing was connected.</div>}
      {s?.reconnect && !isParent && <div className="notice">{me.parentLabel} switched on something new. Connect again so Google can ask you about it.</div>}
      {s && !s.configured && <div className="card"><b>Not set up yet</b><span className="small">{me.parentLabel} needs to add a Google sign-in for Kith first (docs/google.md).</span></div>}
      {s?.configured && (
        <div className="card" style={{ gap: 10 }}>
          <span className="spread"><b>{s.connected ? `Connected: ${s.email}` : "Not connected"}</b><span className="small">{s.enabled ? "switched on" : `${me.parentLabel} hasn’t switched it on`}</span></span>
          <span style={{ fontSize: "0.875rem", color: "var(--text-3)" }}>
            {name} keeps everything on its desk at home anyway. With Google connected, it also saves what it makes into a <b>Kith</b> folder in your Drive
            (Stories, Revision, Presentations, Games &amp; artifacts, OCs): stories as Docs, flashcards as Sheets too, presentations as Slides.
          </span>
          <b style={{ fontSize: "0.875rem" }}>What {name} can do</b>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.8438rem", color: "var(--text-3)" }}>
            <li>Save what it makes into your Kith folder. {f?.edit ? "It can also read and edit Docs, Sheets and Slides you pick for it below, and ones it made, but only after you say yes to each change. Google keeps every version (File › Version history), and it never edits coursework." : "It never edits your files."}</li>
            {f?.calendar && <li>See your Google Calendar, and add events (revision, tests, reminders) when you say yes. It only changes or removes events it added, and never invites anyone.</li>}
            {f?.tasks && <li>Read your “Homework” list in Google Tasks, and add or tick things off with you.</li>}
            <li>It can never see the rest of your Drive, your Gmail, contacts or photos, and never deletes, moves or shares your files{s.sharedWith ? `, except the Kith folder, view-only, with ${me.parentLabel} (${s.sharedWith})` : ""}.</li>
            <li>Everything it reads or changes is listed in “What {me.parentLabel} sees”.</li>
          </ul>
          {!isParent && (!s.connected || s.reconnect) && <button className="btn primary" onClick={connect}>{s.connected ? "Connect again" : "Connect my Google account"}</button>}
          {s.connected && <button className="btn ghost small" onClick={disconnect}>Disconnect</button>}
          {!isParent && !s.connected && <span className="small">If your Google account is supervised with Family Link, {me.parentLabel} may need to approve Kith.</span>}
        </div>
      )}
      {!isParent && pending.length > 0 && (
        <div className="card" style={{ gap: 10 }}>
          <b>Waiting for your yes</b>
          {pending.map((p) => <ConfirmCard key={p.id} p={p} onDone={load} />)}
        </div>
      )}
      {s?.connected && f?.edit && (
        <div className="card" style={{ gap: 10 }}>
          <b>Files {name} can open</b>
          {!isParent && s.picker && (
            <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
              <button className="btn ghost small" onClick={() => pick(false)}>Pick a Doc, Sheet or Slides</button>
              <button className="btn ghost small" onClick={() => pick(true)}>Pick coursework (read only)</button>
            </div>
          )}
          {!s.picker && <span className="small">The Google Picker isn’t set up, so for now {name} can only open files it made.</span>}
          {files.length === 0 && <span className="small">None yet.</span>}
          {files.map((x) => (
            <div key={x.id} className="memrow">
              <span className="t" style={{ flex: 1 }}><b>{x.name}</b> <span className="small">{KIND_NAME[x.mime] ?? "file"} · {x.source === "picked" ? "you picked it" : `${name} made it`}</span></span>
              {x.coursework ? (
                isParent ? <button className="chip" onClick={() => markCoursework(x.id, false)}>Coursework · undo</button> : <span className="small" style={{ color: "var(--ember)", paddingRight: 8 }}>coursework: read only</span>
              ) : !isParent && <button className="chip" onClick={() => markCoursework(x.id, true)}>It’s coursework</button>}
            </div>
          ))}
          <span className="small">Coursework has to be all your own work, so {name} explains and gives feedback but never edits it. Only {me.parentLabel} can take that mark off.</span>
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

/** Opens Google's file picker for a Doc, Sheet or Slides file. drive.file: Kith gets just that file. */
export async function pickGoogleFile(types = ["application/vnd.google-apps.document", "application/vnd.google-apps.spreadsheet", "application/vnd.google-apps.presentation"]): Promise<{ id: string; name: string; mimeType: string } | null> {
  const cfg = await api<{ token: string; apiKey: string; appId: string }>("/api/google/picker");
  await loadScript("https://apis.google.com/js/api.js");
  await new Promise<void>((r) => window.gapi!.load("picker", () => r()));
  const P = window.google!.picker;
  return new Promise((resolve) => {
    const view = new P.DocsView(P.ViewId.DOCS).setMimeTypes(types.join(","));
    new P.PickerBuilder()
      .addView(view).setOAuthToken(cfg.token).setDeveloperKey(cfg.apiKey).setAppId(cfg.appId)
      .setCallback((d: { action: string; docs?: { id: string; name: string; mimeType: string }[] }) => {
        if (d.action === P.Action.PICKED && d.docs?.[0]) resolve({ id: d.docs[0].id, name: d.docs[0].name, mimeType: d.docs[0].mimeType });
        if (d.action === P.Action.CANCEL) resolve(null);
      })
      .build().setVisible(true);
  });
}

/** Opens Google's file picker and returns the text of the doc they choose (or null if cancelled). */
export async function pickGoogleDoc(): Promise<{ text: string; name: string } | null> {
  const picked = await pickGoogleFile(["application/vnd.google-apps.document"]);
  if (!picked) return null;
  const { text } = await api<{ text: string }>("/api/google/read-picked", { body: { fileId: picked.id, name: picked.name } });
  return { text, name: picked.name };
}
