// A Google change the companion suggested, waiting for the child's yes. Nothing changes in her
// Google account until she taps Yes; a file edit keeps Google's version history.

import { useState } from "react";
import { api, type GooglePending } from "../api";
import { Icon } from "./Icons";

const MARK: Record<string, string> = { "+": "+", "-": "−", "~": "~", "·": "" };

export function ConfirmCard({ p, onDone }: { p: GooglePending; onDone?: () => void }) {
  const [state, setState] = useState<"ask" | "busy" | "done" | "no">(p.status === "pending" ? "ask" : "done");
  const [msg, setMsg] = useState(p.status === "applied" ? p.result : "");
  const yes = async () => {
    setState("busy");
    try { const r = await api<{ message: string }>(`/api/google/actions/${p.id}/apply`, { body: {} }); setMsg(r.message); setState("done"); }
    catch (e) { setMsg((e as Error).message); setState("done"); }
    onDone?.();
  };
  const no = async () => { await api(`/api/google/actions/${p.id}/decline`, { body: {} }).catch(() => undefined); setState("no"); onDone?.(); };
  return (
    <div className="confirmcard" role="group" aria-label={p.title}>
      <b style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><Icon name={p.kind === "calendar" ? "calendar" : p.kind === "tasks" ? "check" : "note"} size={16} />{p.title}</b>
      <div className="difflines">
        {p.lines.map((l, i) => <div key={i} className={`dl dl-${l.op === "+" ? "add" : l.op === "-" ? "del" : l.op === "~" ? "chg" : "note"}`}><span aria-hidden>{MARK[l.op]}</span>{l.text}</div>)}
      </div>
      {state === "ask" && (
        <div className="row" style={{ gap: 8 }}>
          <button className="btn primary small" onClick={yes}>Yes, do it</button>
          <button className="btn ghost small" onClick={no}>No thanks</button>
        </div>
      )}
      {state === "busy" && <span className="small">Doing it…</span>}
      {state === "done" && msg && <span className="small">{msg}</span>}
      {state === "no" && <span className="small">Okay, nothing changed.</span>}
    </div>
  );
}
