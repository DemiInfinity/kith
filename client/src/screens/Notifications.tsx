import { useEffect, useState } from "react";
import { api, type Me, type Profile } from "../api";
import { Toggle } from "../components/bits";
import { disablePush, enablePush, pushStatus } from "../lib/push";
import { isMacApp } from "../lib/native";

/** Notifications on their phone: switch on, test, and choose which kinds. */
export function Notifications({ me, onSaved }: { me: Me; onSaved: (p: Profile) => void }) {
  const [status, setStatus] = useState<"unsupported" | "off" | "on" | "blocked" | "…">("…");
  const [p, setP] = useState(me.profile);
  const [msg, setMsg] = useState("");
  const mac = isMacApp();
  useEffect(() => { if (!mac) pushStatus().then(setStatus).catch(() => setStatus("unsupported")); }, [mac]);
  const name = me.profile.name;
  const iPhone = /iPhone|iPad/.test(navigator.userAgent);
  const standalone = matchMedia("(display-mode: standalone)").matches;

  const toggle = async () => {
    setMsg("");
    try {
      if (status === "on") { await disablePush(); setStatus("off"); }
      else { await enablePush(me.push.publicKey); setStatus("on"); setMsg("Notifications are on."); }
    } catch (e) { setMsg((e as Error).message); }
  };
  const test = async () => {
    try {
      const r = await api<{ sent: number }>("/api/push/test", { body: {} });
      // The Mac app picks it up from the server within half a minute.
      setMsg(mac ? "Sent! It’ll pop up within half a minute." : r.sent ? "Sent! It should pop up in a moment." : "Nothing was sent: switch notifications on first.");
    }
    catch (e) { setMsg((e as Error).message); }
  };
  const setKind = async (k: keyof Profile["notifications"], v: boolean) => {
    const next = { ...p.notifications, [k]: v };
    setP({ ...p, notifications: next });
    onSaved(await api<Profile>("/api/profile", { method: "PUT", body: { notifications: next } }));
  };

  return (
    <div className="screen narrow">
      <span className="hand">on your phone</span>
      <h2 className="screen-title">Notifications</h2>
      {mac && (
        <div className="card" style={{ gap: 10 }}>
          <b>On this Mac, notifications come from the Kith app</b>
          <span className="small">They show up even when the window is closed, as long as Kith is in the menu bar. The first one asks for permission. You can change how they look in System Settings › Notifications › Kith.</span>
          <div className="row"><button className="btn ghost small" onClick={test}>Send a test</button></div>
        </div>
      )}
      {!mac && !me.push.ready && <div className="notice">{me.parentLabel} needs to finish setting up notifications on the home server first (the VAPID keys in docs/setup.md).</div>}
      {!mac && iPhone && !standalone && (
        <div className="card">
          <b>On an iPhone, add Kith to your Home Screen first</b>
          <span style={{ fontSize: "0.875rem" }}>1. Tap the Share button in Safari. 2. Choose “Add to Home Screen”. 3. Open Kith from your Home Screen and come back here.</span>
        </div>
      )}
      {!mac && me.push.ready && status !== "unsupported" && (
        <div className="card" style={{ gap: 10 }}>
          <span className="spread"><b>{status === "on" ? "Notifications are on" : status === "blocked" ? "Notifications are blocked" : "Notifications are off"}</b></span>
          {status === "blocked" && <span className="small">They’re blocked in your phone’s settings for this site. Allow them there, then come back.</span>}
          <div className="row">
            <button className={`btn small ${status === "on" ? "ghost" : "primary"}`} onClick={toggle} disabled={status === "blocked" || status === "…"}>{status === "on" ? "Turn off on this phone" : "Turn on"}</button>
            {status === "on" && <button className="btn ghost small" onClick={test}>Send a test</button>}
          </div>
        </div>
      )}
      {!mac && status === "unsupported" && !(iPhone && !standalone) && <span className="small">This browser can’t show notifications.</span>}
      <div className="card" style={{ gap: 2 }}>
        <b>What can reach you</b>
        <Toggle label={`Check-ins from ${name} (at most twice a day)`} checked={p.notifications.checkins} onChange={(v) => setKind("checkins", v)} />
        <Toggle label="Reminders you asked for" checked={p.notifications.reminders} onChange={(v) => setKind("reminders", v)} />
        <Toggle label={`When something ${name} made for you is ready`} checked={p.notifications.deskReady} onChange={(v) => setKind("deskReady", v)} />
      </div>
      {msg && <div className="notice" style={{ alignSelf: "stretch" }}>{msg}</div>}
      <span className="small">Nothing ever arrives in quiet hours ({me.quietHours.start}–{me.quietHours.end}); reminders wait until morning. {name} never calls you, and never guilt-trips.</span>
    </div>
  );
}
