// Something the companion asked to change about itself (its soul, a memory) or changed (how it
// talks, a check-in), as a small card under its reply. A soul or memory change waits for her yes;
// a tweak has an Undo that puts back exactly what was there.

import { useState } from "react";
import { api, type PipChange, type Profile } from "../api";
import { Icon } from "./Icons";

const MARK: Record<string, string> = { "+": "+", "-": "−", "~": "", "·": "" };

/** What happened to it, in a few words (also after a reload). */
export function outcome(c: PipChange, name = "Pip"): string {
  if (c.kind === "soul") {
    return ({ accepted: "Done: my soul’s changed. Thank you!", declined: "Okay, I left my soul as it was.", expired: "This one ran out, so nothing changed.", replaced: "I asked something newer instead.", failed: c.result || "Nothing changed." } as Record<string, string>)[c.status] ?? "";
  }
  if (c.kind === "memory") {
    return ({ accepted: `Remembered. You can see it in What ${name} remembers.`, declined: "Okay, I won’t remember that.", expired: "This one ran out, so I didn’t remember it.", failed: c.result || "I didn’t remember it." } as Record<string, string>)[c.status] ?? "";
  }
  return c.status === "undone" ? "Undone: it’s back how it was." : "";
}

export function ChangeCard({ c, name, onChange, onProfile }: { c: PipChange; name: string; onChange?: (c: PipChange) => void; onProfile?: (p: Profile) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const act = async (what: "accept" | "decline" | "undo") => {
    setBusy(true);
    setErr("");
    try {
      const r = await api<{ change: PipChange; profile?: Profile }>(`/api/pip/changes/${c.id}/${what}`, { body: {} });
      onChange?.(r.change);
      if (r.profile) onProfile?.(r.profile);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const tweak = c.kind === "personality" || c.kind === "checkins";
  const yes = c.kind === "soul" ? "Yes, change it" : "Yes, remember it";
  const no = c.kind === "soul" ? "Not now" : "No thanks";
  const said = outcome(c, name);

  if (tweak) {
    return (
      <div className="confirmcard changecard" role="group" aria-label={c.title}>
        <span className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Icon name={c.kind === "checkins" ? "bell" : "mask"} size={16} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <b>{c.title}:</b> {c.lines.map((l) => l.text).join(" · ")}
          </span>
          {c.canUndo && <button className="btn ghost small" disabled={busy} onClick={() => act("undo")}>Undo</button>}
        </span>
        {said && <span className="small">{said}</span>}
        {err && <span className="small" role="alert">{err}</span>}
      </div>
    );
  }
  return (
    <div className="confirmcard changecard" role="group" aria-label={c.title}>
      <b style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><Icon name={c.kind === "soul" ? "star" : "brain"} size={16} />{c.title}</b>
      <div className="difflines" tabIndex={0} aria-label={`The words: ${c.lines.length} line${c.lines.length === 1 ? "" : "s"}`}>
        {c.lines.map((l, i) => (
          <div key={i} className={`dl dl-${l.op === "+" ? "add" : l.op === "-" ? "del" : l.op === "~" ? "chg" : "note"}`}>
            <span aria-hidden>{MARK[l.op]}</span>{l.text}
          </div>
        ))}
      </div>
      {c.why && <span className="small">Why: {c.why}</span>}
      {c.status === "pending" ? (
        <div className="row" style={{ gap: 8 }}>
          <button className="btn primary small" disabled={busy} onClick={() => act("accept")}>{yes}</button>
          <button className="btn ghost small" disabled={busy} onClick={() => act("decline")}>{no}</button>
        </div>
      ) : said && <span className="small">{said}</span>}
      {err && <span className="small" role="alert">{err}</span>}
    </div>
  );
}
