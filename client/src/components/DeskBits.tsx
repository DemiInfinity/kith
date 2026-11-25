// Pieces about Pip's desk that live outside the desk itself: the desk rules (in Settings) and what
// Pip did today (the profile's Today tab). The desk's limit is one of the bars in Settings › Usage.

import { useEffect, useState } from "react";
import { api } from "../api";
import { Icon } from "./Icons";

export interface DeskToday {
  activity: { id: number; ts: number; icon: string; text: string }[];
  budget: { slice: number; allowanceLeft: number; percent: number; canWork: boolean; full: number; low: number };
  google: boolean;
}

export function useDeskToday(): DeskToday | null {
  const [today, setToday] = useState<DeskToday | null>(null);
  useEffect(() => { api<DeskToday>("/api/desk/today").then(setToday).catch(() => undefined); }, []);
  return today;
}

export function DeskRules({ name }: { name: string }) {
  return (
    <div className="card">
      <b>{name}’s desk rules</b>
      <div className="grid2" style={{ fontSize: "0.8125rem" }}>
        <div className="stack" style={{ gap: 3 }}><b style={{ color: "var(--ok)" }}>{name} can</b><span>write, draw and build little things</span><span>read websites that aren’t blocked</span><span>save new files to Kith on Drive</span><span>make flashcards and plans</span><span>keep its own journal</span></div>
        <div className="stack" style={{ gap: 3 }}><b style={{ color: "var(--ember)" }}>{name} can’t</b><span>do coursework for you</span><span>sign in, fill forms, download or pass robot checks</span><span>share, email or post anything</span><span>delete or overwrite your files</span><span>contact your friends</span></div>
      </div>
      <span className="small">The desk is a locked-down container on your home server. It can’t touch the rest of the house.</span>
    </div>
  );
}

export function TodayList({ today, name, parentLabel }: { today: DeskToday | null; name: string; parentLabel: string }) {
  return (
    <div className="card">
      <div className="spread"><b>What {name} did today</b><span className="small" style={{ display: "inline-flex", gap: 4, alignItems: "center" }}><Icon name="eye" size={14} /> {parentLabel} sees this too</span></div>
      {!today && <span className="small">Loading…</span>}
      {today && today.activity.length === 0 && <span className="small">Nothing yet today.</span>}
      {today?.activity.map((a) => (
        <div key={a.id} className="row" style={{ fontSize: "0.8438rem", borderTop: "1px solid var(--line-soft)", paddingTop: 6, alignItems: "flex-start" }}>
          <b style={{ width: 44, flex: "none", color: "var(--faint)" }}>{new Date(a.ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</b>
          <span style={{ flex: 1 }}>{a.text}</span><span>{a.icon}</span>
        </div>
      ))}
    </div>
  );
}
