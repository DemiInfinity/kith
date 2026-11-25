import { useCallback, useEffect, useState } from "react";
import { api, type Character, type CloudLink, type DeskItem, type DeskView, type Energy, type Job, type Me } from "../api";
import { AvatarSvg } from "../components/Avatar";
import { clock } from "../components/bits";
import { ItemViewer, MakeSheet } from "./Desk";

interface BrowserView {
  enabled: boolean; sites: string[];
  live: { busy: boolean; url: string; title: string; why: string; jobId: number | null; ts: number; frame: string } | null;
  visits: { id: number; ts: number; url: string; title: string; why: string; job_id: number | null; outcome: string }[];
}
interface Today {
  activity: { id: number; ts: number; icon: string; text: string }[];
  budget: { slice: number; allowanceLeft: number; percent: number; canWork: boolean; full: number; low: number };
  power: Energy; google: boolean;
}
interface StoryRow { id: number; title: string; friendLabel: string }

type Folder = "browser" | "stories" | "shared" | "revision" | "art" | "games" | "journal";
const REVISION = new Set(["notes", "flashcards", "quiz", "timer", "timeline", "slides"]);
const STORY = new Set(["story", "adventure", "comic"]);
const ART = new Set(["sketch", "palette", "map"]);

function folderOf(it: DeskItem): Folder {
  if (it.characterIds.length || ART.has(it.kind)) return "art";
  if (STORY.has(it.kind)) return "stories";
  if (REVISION.has(it.kind)) return "revision";
  return "games";
}

function tagFor(it: DeskItem, link?: CloudLink): [string, string] {
  if (link) return it.kind === "slides" ? ["Slides", "slides"] : it.format === "md" ? ["Doc", "doc"] : ["In Drive", "doc"];
  if (it.format === "md") return ["Doc", "doc"];
  if (it.format === "svg") return ["Drawing", "me"];
  return ["App", "app"];
}

const TAG: Record<string, React.CSSProperties> = {
  doc: { background: "#E3F0FF", color: "#1F5FAD" }, draft: { background: "#FFE7B8", color: "#8A5A12" }, lock: { background: "#FFE1DC", color: "#A8402E" },
  sheet: { background: "#DFF5E7", color: "#1E7A45" }, slides: { background: "#FFEBD6", color: "#B05A10" }, app: { background: "#EEDDF6", color: "#7A3C8A" }, me: { background: "#F1E4EF", color: "#7A5C76" },
};

/** Pip's desk, as designed: its own little computer at home, with nothing hidden. */
export function DeskComputer({ me, canEdit = true, go }: { me: Me; canEdit?: boolean; go?: (to: string) => void }) {
  const [desk, setDesk] = useState<DeskView | null>(null);
  const [br, setBr] = useState<BrowserView | null>(null);
  const [today, setToday] = useState<Today | null>(null);
  const [stories, setStories] = useState<StoryRow[]>([]);
  const [chars, setChars] = useState<Character[]>([]);
  const [open, setOpen] = useState<Folder>("browser");
  const [item, setItem] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const [watch, setWatch] = useState(false);
  const [now, setNow] = useState(Date.now());
  const name = me.profile.name;

  const load = useCallback(() => {
    api<DeskView>("/api/desk").then(setDesk).catch(() => undefined);
    api<BrowserView>("/api/desk/browser").then(setBr).catch(() => undefined);
    api<Today>("/api/desk/today").then(setToday).catch(() => undefined);
  }, []);
  useEffect(() => {
    load();
    api<{ stories: StoryRow[] }>("/api/stories").then((r) => setStories(r.stories)).catch(() => undefined);
    api<{ characters: Character[] }>("/api/oc").then((r) => setChars(r.characters)).catch(() => undefined);
    const t = setInterval(() => { load(); setNow(Date.now()); }, 6000);
    return () => clearInterval(t);
  }, [load]);
  // "Watch live": refresh the browser view every two seconds.
  useEffect(() => {
    if (!watch) return;
    const t = setInterval(() => api<BrowserView>("/api/desk/browser").then(setBr).catch(() => undefined), 2000);
    return () => clearInterval(t);
  }, [watch]);

  const items = desk?.items ?? [];
  const links = desk?.links ?? [];
  const working = desk?.jobs.find((j) => j.status === "working");
  const friend = stories[0]?.friendLabel;
  const folders: [Folder, string, string][] = [
    ["browser", "🧭", `${name}’s browser`], ["stories", "📖", "Stories"], ["shared", "🤝", friend ? `Story with ${friend}` : "Shared stories"],
    ["revision", "📚", "GCSE revision"], ["art", "🎨", "Art & OCs"], ["games", "🎮", "Games & things"], ["journal", "📔", `${name}’s journal`],
  ];
  const todo = (desk?.jobs ?? []).filter((j) => j.status !== "failed" || Date.now() - j.ts < 86_400_000).slice(0, 6);
  const visitsForLive = br?.live?.jobId ? br.visits.filter((v) => v.job_id === br.live!.jobId && v.outcome === "read").length : 0;

  const fileList = (list: { key: string; icon: string; name: string; meta: string; tag: [string, string]; onClick?: () => void }[], path: string, note: string) => (
    <div className="dwin-body">
      <span className="small" style={{ color: "#7A5C76" }}>{path}</span>
      <span style={{ fontSize: 13, color: "#5a4a63" }}>{note}</span>
      {list.length === 0 && <span style={{ fontSize: 13, color: "#7A5C76" }}>Nothing here yet.</span>}
      {list.map((f) => (
        <button key={f.key} className="dfile" onClick={f.onClick} disabled={!f.onClick}>
          <span style={{ fontSize: 20 }}>{f.icon}</span>
          <span style={{ flex: 1, textAlign: "left" }}><b style={{ display: "block", fontSize: 14 }}>{f.name}</b><span style={{ fontSize: 12, color: "#7A5C76" }}>{f.meta}</span></span>
          <span className="dtag" style={TAG[f.tag[1]]}>{f.tag[0]}</span>
        </button>
      ))}
    </div>
  );

  const asFiles = (f: Folder) => items.filter((it) => folderOf(it) === f).map((it) => {
    const link = links.find((l) => l.item_id === it.id);
    return { key: it.id, icon: it.icon, name: it.title, meta: `${it.summary || it.kind}${link ? " · in Google Drive" : ""}${it.version > 1 ? ` · v${it.version}` : ""}`, tag: tagFor(it, link), onClick: () => setItem(it.id) };
  });

  let windowTitle = "";
  let body: React.ReactNode = null;
  if (open === "browser") {
    const live = br?.live;
    windowTitle = live?.title || `${name}’s browser`;
    body = (
      <div className="dbrowser">
        <div className="durl"><span>🔒</span><span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{live?.url ? live.url.replace(/^https:\/\//, "") : "nothing open"}</span><span className="dtag" style={{ background: "#DFF5E7", color: "#1E7A45" }}>✓ Safe list</span></div>
        <div className="dbrowse-grid">
          <div className="dshot">
            {!br?.enabled && <span style={{ color: "#7A5C76", fontSize: 13 }}>{me.parentLabel} has switched browsing off.</span>}
            {br?.enabled && live?.frame && <img src={live.frame} alt={`What ${name} is reading: ${live.title}`} />}
            {br?.enabled && !live?.frame && <span style={{ color: "#7A5C76", fontSize: 13 }}>{name} only browses when it’s looking something up for you.</span>}
          </div>
          <div className="dwhy">
            <b>Why {name} is here</b>
            <span>{live?.why ? `You asked: “${live.why}”` : "—"}</span>
            <b>This visit</b>
            <span>{visitsForLive ? `${visitsForLive} page${visitsForLive > 1 ? "s" : ""}, all on the safe list.` : "—"} Reading only: no sign-ins, forms or downloads.</span>
            <button className={`btn small ${watch ? "primary" : ""}`} style={!watch ? { background: "#2A1D3A", color: "#fff" } : {}} onClick={() => setWatch(!watch)}>👀 {watch ? "Watching live" : "Watch live"}</button>
          </div>
        </div>
        <details className="dvisits"><summary>Every page today ({br?.visits.length ?? 0})</summary>
          {br?.visits.map((v) => <div key={v.id} style={{ fontSize: 12.5 }}>{clock(v.ts)} · {v.outcome} · {v.title || v.url.replace(/^https:\/\//, "")}<span style={{ color: "#7A5C76" }}> · for {v.why}</span></div>)}
        </details>
      </div>
    );
  } else if (open === "stories") {
    windowTitle = "Stories";
    body = fileList(asFiles("stories"), "Kith / Stories", `Your stories. ${name} drafts only when you ask, and new versions sit beside the old ones.`);
  } else if (open === "shared") {
    windowTitle = friend ? `Stories with ${friend}` : "Shared stories";
    body = fileList(stories.map((s) => ({ key: String(s.id), icon: "📄", name: s.title, meta: `with ${s.friendLabel} · every bit credited`, tag: ["Story", "me"] as [string, string], onClick: go ? () => go("/stories") : undefined })),
      "Kith / Stories", `Written with your friend. ${name} only suggests, and never messages them: you share the doc yourself.`);
  } else if (open === "revision") {
    windowTitle = "GCSE revision";
    body = fileList(asFiles("revision"), "Kith / Revision", "Made on Low power. Plans count back to your mocks and exams.");
  } else if (open === "art") {
    windowTitle = "Art & OCs";
    body = fileList([
      ...chars.map((c) => ({ key: `c${c.id}`, icon: c.sheet.icon, name: `${c.sheet.name}: character sheet`, meta: "OC · looks, backstory, palette", tag: ["OC", "me"] as [string, string], onClick: go ? () => go("/oc") : undefined })),
      ...asFiles("art"),
    ], "Kith / OCs", `Your characters, mood boards and sketches. Art coursework is yours alone: ${name} gives feedback and asks questions, and that’s all.`);
  } else if (open === "games") {
    windowTitle = "Games & things";
    body = fileList(asFiles("games"), "Kith / Games & artifacts", `Little apps ${name} built when you asked. They open in a safe player.`);
  } else {
    windowTitle = `${name}’s journal`;
    body = fileList((desk?.journal ?? []).map((j) => ({ key: j.day, icon: "📝", name: new Date(j.day + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long" }), meta: j.text, tag: ["Note", "me"] as [string, string] })),
      `${name}’s desk / journal`, `${name}’s own notes, so it remembers what matters. You can read every page, and ${me.parentLabel} can too.`);
  }

  const power = today?.power;
  const spent = (today?.budget.full ?? 0) + (today?.budget.low ?? 0);
  const slice = today?.budget.slice || 1;
  return (
    <div className="deskpage">
      <div className="deskmain">
        <div className="pcomp">
          <div className="pbar">
            <b>{name}’s computer</b>
            <span className="pmeta">at home · safe-listed websites only · every page logged</span>
            <span style={{ flex: 1 }} />
            {today?.google && <span className="pchip" style={{ background: "rgba(127,216,164,0.18)", color: "#9BE3B8" }}>☁︎ Drive synced</span>}
            {power && <span className="pchip" style={{ background: power.mode === "full" ? "rgba(245,150,70,0.2)" : "rgba(156,194,232,0.2)", color: power.mode === "full" ? "#F7B57A" : "#B8D4F0" }}>{power.mode === "full" ? "🔥 Full power" : power.mode === "low" ? `🔋 Low power${power.fullBackAt ? ` until ${clock(power.fullBackAt)}` : ""}` : "😴 Resting"}</span>}
            <b>{new Date(now).toLocaleDateString("en-GB", { weekday: "short" })} {clock(now)}</b>
          </div>
          <div className="pscreen">
            <div className="pfolders">
              {folders.map(([k, ic, label]) => (
                <button key={k} className={`picon ${open === k ? "on" : ""}`} onClick={() => setOpen(k)} aria-pressed={open === k}><span>{ic}</span><span>{label}</span></button>
              ))}
            </div>
            <div className="pcenter">
              <div className="dwin">
                <div className="dwin-tb"><i style={{ background: "#FF5F57" }} /><i style={{ background: "#FEBC2E" }} /><i style={{ background: "#28C840" }} /><b>{windowTitle}</b>
                  {canEdit && open !== "browser" && open !== "journal" && <button className="dmake" onClick={() => setMaking(true)}>+ Make</button>}</div>
                {body}
              </div>
              <div className="ptodo" role="list" aria-label={`${name}’s to-do`}>
                <b className="hand" style={{ color: "#2A1D3A", fontSize: 28 }}>{name}’s to-do</b>
                <span style={{ fontSize: 11.5, fontWeight: 800, color: "#8A5A12" }}>You asked for these · {name} works on them in its own time</span>
                {todo.length === 0 && <span style={{ fontSize: 13 }}>Nothing yet. Ask {name} to make something!</span>}
                {todo.map((j: Job) => (
                  <span key={j.id} role="listitem" style={{ fontSize: 13.5, borderTop: "1px dashed #E8C98A", paddingTop: 5, textDecoration: j.status === "done" ? "line-through" : "none", opacity: j.status === "done" ? 0.6 : 1 }}>
                    {j.status === "done" ? "✓" : j.status === "working" ? "…" : j.status === "failed" ? "✕" : "○"} {j.title}
                  </span>
                ))}
              </div>
              <div className="pbuddy">
                <AvatarSvg look={me.profile.look} mood={working ? "thinking" : power?.mode === "low" ? "sleepy" : "happy"} size={96} />
                <span className="hand" style={{ fontSize: 22 }}>{working ? "concentrating…" : "free for now"}</span>
              </div>
            </div>
          </div>
          <div className="pnow">
            <span className={`dot ${working ? "" : "idle"}`} />
            <span style={{ flex: 1 }}><b>Now:</b> {working ? desk?.status.activity || `making ${working.title}` : `${name}’s desk is quiet`}</span>
            {working && <><span className="bar" style={{ width: 180, height: 8 }}><span style={{ width: `${working.progress}%`, background: "linear-gradient(90deg,#D9A3E0,#F59646)" }} /></span><b>{working.progress}%</b></>}
          </div>
        </div>
        <span className="small">{name}’s desk is a locked-down container on the home server. {name} can write, draw and build small things there{today?.google ? ", and save them into the Kith folder in your Google Drive" : ""}. Its browser only opens websites on the family safe list, treats what it reads as information rather than instructions, and logs every page. It can’t sign in, install anything, message anyone, delete your files or touch the rest of the house.</span>
      </div>

      <aside className="deskside">
        <div className="card">
          <div className="spread"><b style={{ fontFamily: "var(--serif)", fontSize: 20 }}>Desk budget today</b><span className="small">{today ? `${today.budget.percent}% left` : ""}</span></div>
          <span className="bar" style={{ display: "flex", height: 10 }}>
            <span style={{ width: `${Math.min(100, (today?.budget.full ?? 0) / slice * 100)}%`, background: "var(--lilac)", borderRadius: 0 }} />
            <span style={{ width: `${Math.min(100, (today?.budget.low ?? 0) / slice * 100)}%`, background: "var(--ember)", borderRadius: 0 }} />
          </span>
          <span className="small"><span style={{ color: "var(--lilac)" }}>●</span> Full power {Math.round((today?.budget.full ?? 0) / slice * 100)}% <span style={{ color: "var(--ember)" }}>●</span> Low power {Math.round((today?.budget.low ?? 0) / slice * 100)}%{spent > slice ? " (using days saved up this week)" : ""}</span>
          <span className="small">Flashcards, summaries and planning always run on Low power. Stories and games you ask for get Full power, and the desk can never eat into your chat.</span>
        </div>
        <div className="card">
          <div className="spread"><b style={{ fontFamily: "var(--serif)", fontSize: 20 }}>What {name} did today</b><span className="small">👀 {me.parentLabel} sees this too</span></div>
          {(today?.activity ?? []).length === 0 && <span className="small">Nothing yet today.</span>}
          {today?.activity.slice(0, 12).map((a) => (
            <div key={a.id} className="row" style={{ fontSize: 13.5, borderTop: "1px solid var(--line-soft)", paddingTop: 6, alignItems: "flex-start" }}>
              <b style={{ width: 44, flex: "none", color: "var(--faint)" }}>{new Date(a.ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</b>
              <span style={{ flex: 1 }}>{a.text}</span><span>{a.icon}</span>
            </div>
          ))}
        </div>
        <div className="card">
          <b style={{ fontFamily: "var(--serif)", fontSize: 20 }}>Desk rules</b>
          <div className="grid2" style={{ fontSize: 13 }}>
            <div className="stack" style={{ gap: 3 }}><b style={{ color: "var(--ok)" }}>{name} can</b><span>write, draw and build little things</span><span>read safe-listed websites</span><span>save new files to Kith on Drive</span><span>make flashcards and plans</span><span>keep its own journal</span></div>
            <div className="stack" style={{ gap: 3 }}><b style={{ color: "var(--ember)" }}>{name} can’t</b><span>do coursework for you</span><span>sign in, fill forms or download</span><span>share, email or post anything</span><span>delete or overwrite your files</span><span>contact your friends</span></div>
          </div>
        </div>
        {desk?.journal[0] && (
          <div className="card"><span className="journal">“{desk.journal[0].text}”</span><span style={{ fontSize: 11.5, fontWeight: 800, color: "var(--faint)" }}>{name.toUpperCase()}’S JOURNAL</span></div>
        )}
      </aside>
      {item && <ItemViewer id={item} canEdit={canEdit} links={links} onClose={() => setItem(null)} onChanged={load} />}
      {making && <MakeSheet me={me} onClose={() => setMaking(false)} onStarted={load} />}
    </div>
  );
}
