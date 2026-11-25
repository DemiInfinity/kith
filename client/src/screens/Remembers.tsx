import { Icon, IL } from "../components/Icons";
import { useEffect, useState } from "react";
import { api, type Me, type Memory, type Profile } from "../api";
import { disablePush, enablePush, pushStatus } from "../lib/push";

/** What the companion remembers (the child is in charge) and gentle check-ins. */
export function Remembers({ me, onSaved }: { me: Me; onSaved: (p: Profile) => void }) {
  const [mems, setMems] = useState<Memory[] | null>(null);
  const [p, setP] = useState(me.profile);
  const [push, setPush] = useState<"unsupported" | "off" | "on" | "blocked" | "…">("…");
  const [err, setErr] = useState("");
  const name = p.name;

  useEffect(() => {
    api<{ memories: Memory[] }>("/api/memories").then((r) => setMems(r.memories)).catch((e) => setErr((e as Error).message));
    pushStatus().then(setPush).catch(() => setPush("unsupported"));
  }, []);

  const forget = async (id: number) => {
    setMems((m) => (m ?? []).filter((x) => x.id !== id));
    await api(`/api/memories/${id}`, { method: "DELETE" }).catch(() => undefined);
  };
  const togglePush = async () => {
    setErr("");
    try {
      if (push === "on") { await disablePush(); setPush("off"); }
      else { await enablePush(me.push.publicKey); setPush("on"); }
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="screen narrow">
      <h2 className="screen-title">What {name} remembers</h2>
      <span className="hand sub">you’re in charge</span>
      {mems === null && !err && <span className="small">…</span>}
      {mems?.length === 0 && <span className="small">Nothing yet. {name} remembers things that matter to you, like a big test coming up, and you can delete any of them here.</span>}
      <div className="stack">
        {mems?.map((m) => (
          <div key={m.id} className="memrow">
            <span style={{ fontSize: "1.125rem" }} aria-hidden>{m.icon}</span>
            <span className="t">{m.text}</span>
            <button className="x" aria-label={`Forget “${m.text}”`} onClick={() => forget(m.id)}><Icon name="close" size={16} /></button>
          </div>
        ))}
      </div>

      <b style={{ marginTop: 8 }}>Check-ins</b>
      {/* Check-ins are changed by asking in chat ("stop the morning hellos"), so here they're only shown. */}
      <div className="stack" style={{ gap: 2 }}>
        {([["askHowThingsWent", "Asks how big things went (tests, shows)"], ["morningHello", "A morning hello on school days"], ["waterWhileRevising", "Water reminders while revising"]] as const).map(([k, label]) => (
          <span key={k} className="row" style={{ fontSize: "0.875rem", gap: 8 }}><Icon name={p.checkins[k] ? "check" : "close"} size={16} />{label}<span className="small">{p.checkins[k] ? "on" : "off"}</span></span>
        ))}
        <span className="small">To change these, just ask {me.profile.name} in chat.</span>
      </div>
      {me.push.ready && push !== "unsupported" && (
        <button className="btn ghost small" onClick={togglePush} disabled={push === "blocked" || push === "…"}>
          <IL i="bell">{push === "on" ? "Check-ins can reach this phone (turn off)" : push === "blocked" ? "Notifications are blocked in settings" : "Let check-ins reach this phone"}</IL>
        </button>
      )}
      {push === "unsupported" && <span className="small">To get check-ins on an iPhone, add Kith to your Home Screen first (Share › Add to Home Screen).</span>}
      {err && <span className="small" style={{ color: "var(--ember)" }}>{err}</span>}
      <span className="small">{name} never guilt-trips (“I missed you!”), never messages during quiet hours ({me.quietHours.start}–{me.quietHours.end}), and at most twice a day. {name} never calls you; you call {name}.</span>
    </div>
  );
}
