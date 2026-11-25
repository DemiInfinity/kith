import { useEffect, useState } from "react";
import { api, type Me } from "../api";
import { Icon, IL, type IconName } from "../components/Icons";

interface Connector { id: string; kind: string; name: string; level: "look" | "act"; tools: string[] }

const ICON: Record<string, IconName> = { "home-assistant": "home", kin: "calendar", mcp: "sparkle", jellyfin: "music", calculator: "note", dictionary: "stories", web: "compass", "google-drive": "cloud" };
const WHAT: Record<string, (name: string, act: boolean) => string> = {
  "home-assistant": (n, act) => act ? `${n} can check and change the things in your room that you asked about (like your lights).` : `${n} can check the things in your room, but not change them.`,
  kin: (n) => `${n} can look at the family calendar, chores and reminders.`,
  mcp: (n, act) => act ? `${n} can use this service’s tools listed below.` : `${n} can look things up with this service’s tools listed below.`,
  jellyfin: (n, act) => act ? `${n} can find films and music, and make you playlists.` : `${n} can find films and music for you.`,
  calculator: (n) => `${n} can do exact maths.`,
  dictionary: (n) => `${n} can look up what words mean.`,
  web: (n) => `${n} can read the websites listed here.`,
  "google-drive": (n) => `${n} can save what it makes to the Kith folder in your Google Drive.`,
};

/** What the companion is connected to: only what the grown-up switched on, and what each one lets it do. */
export function Connectors({ me }: { me: Me }) {
  const [list, setList] = useState<Connector[] | null>(null);
  const name = me.profile.name;
  useEffect(() => { api<{ connectors: Connector[] }>("/api/connectors").then((r) => setList(r.connectors)).catch(() => setList([])); }, []);
  return (
    <div className="screen narrow dgrid">
      <span className="hand">what {name} can use</span>
      <h2 className="screen-title">Connectors</h2>
      <span className="small">{me.parentLabel} chooses these. Each one is either <b>look only</b> or <b>can act</b>, and {me.parentLabel} can see every time {name} uses one. {name} never spends money, messages anyone or posts online, whatever is connected.</span>
      {list === null && <span className="small">…</span>}
      {list?.length === 0 && <div className="card full"><b>Nothing connected yet</b><span className="small">{name} just chats, helps and makes things on its desk for now. Ask {me.parentLabel} if there’s something you’d like {name} to be able to use.</span></div>}
      {list?.map((c) => (
        <div key={c.id} className="card ccon">
          <div className="row" style={{ gap: 12 }}>
            <span className="psec-ic"><Icon name={ICON[c.kind] ?? "home"} size={18} /></span>
            <b style={{ flex: 1, fontFamily: "var(--serif)", fontSize: 18 }}>{c.name}</b>
            <span className={`clevel ${c.level}`}><IL i={c.level === "act" ? "sparkle" : "eye"} size={13}>{c.level === "act" ? "can act" : "look only"}</IL></span>
          </div>
          <span style={{ fontSize: 14, color: "var(--text-3)" }}>{(WHAT[c.kind] ?? ((n: string) => `${n} can use this.`))(name, c.level === "act")}</span>
          {c.tools.length > 0 && <div className="chips">{c.tools.map((t) => <span key={t} className="chip" style={{ minHeight: 28, fontSize: 12 }}>{t.replace(/_/g, " ")}</span>)}</div>}
        </div>
      ))}
    </div>
  );
}
