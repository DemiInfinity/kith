import { Icon, type IconName } from "./Icons";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, type Energy, type Helpline } from "../api";

// ── Routing (tiny, no dependency) ───────────────────────────────────────────────────────────

export function useRoute(): [string, (to: string) => void] {
  const [path, setPath] = useState(() => location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    addEventListener("popstate", on);
    return () => removeEventListener("popstate", on);
  }, []);
  return [path, (to: string) => {
    if (to !== location.pathname) history.pushState(null, "", to);
    setPath(to);
  }];
}

// ── Time words ──────────────────────────────────────────────────────────────────────────────

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export function clock(ts: number) {
  const d = new Date(ts);
  const h = d.getHours(), m = d.getMinutes();
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
}
export function when(ts: number) {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return `at ${clock(ts)}`;
  if (ts - now.getTime() < 7 * 86_400_000 && ts > now.getTime()) return DAYS[d.getDay()];
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
export function dayLabel(ts: number) {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  if (now.getTime() - ts < 6 * 86_400_000) return DAYS[d.getDay()];
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

// ── Energy (the child sees energy, never money) ─────────────────────────────────────────────

export function energyWords(e: Energy) {
  const resets = DAYS[new Date(e.weekResetsAt).getDay()];
  if (e.mode === "full") {
    return { icon: "fire" as IconName, title: "Full power", pct: `${e.percent}% left`, sub: `this week’s energy · tops up ${resets}` };
  }
  if (e.mode === "low") {
    const back = e.fullBackAt ? ` Full power is back ${when(e.fullBackAt)}.` : "";
    return { icon: "battery" as IconName, title: "Low power", pct: `${e.percent}% left · resets ${resets}`, sub: `I can still chat, just a bit simpler.${back} “Grown-up?” always works.` };
  }
  const back = e.limitedBy === "month" ? "Back when topped up" : e.fullBackAt ? `Back ${when(e.fullBackAt)}` : "Back soon";
  return { icon: "moon" as IconName, title: "Resting", pct: back, sub: "I’m out of energy for now. “Grown-up?” always works, even while I rest." };
}

export function EnergyCard({ energy, compact }: { energy: Energy; compact?: boolean }) {
  const w = energyWords(energy);
  const fill = <span className="bar" style={{ height: compact ? 8 : 10 }}><span className={`fill ${energy.mode}`} style={{ width: `${Math.max(energy.percent, energy.mode === "resting" ? 0 : 3)}%` }} /></span>;
  if (compact) {
    return (
      <div className={`energy compact ${energy.mode}`}>
        <span className="spread"><b style={{ fontSize: "0.875rem", display: "inline-flex", alignItems: "center", gap: 5 }}><Icon name={w.icon} size={16} />{w.title}</b><span style={{ fontSize: "0.7188rem", fontWeight: 800, color: "var(--lilac-soft)" }}>{energy.mode === "resting" ? w.pct : `${energy.percent}% left`}</span></span>
        {fill}
        <span style={{ fontSize: "0.7188rem", color: "var(--muted)" }}>{energy.mode === "full" ? w.sub : energy.mode === "low" ? "simpler for now · Grown-up? always works" : w.pct}</span>
      </div>
    );
  }
  return (
    <div className={`energy ${energy.mode}`} role="status">
      <span className="big" aria-hidden><Icon name={w.icon} size={30} /></span>
      <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="spread"><b style={{ fontSize: "1rem" }}>{w.title}</b><span style={{ fontSize: "0.75rem", fontWeight: 800, color: "var(--lilac-soft)" }}>{w.pct}</span></span>
        {fill}
        <span style={{ fontSize: "0.7812rem", lineHeight: 1.45, color: "var(--text-3)" }}>{w.sub}</span>
      </span>
    </div>
  );
}

export function PowerChip({ energy }: { energy: Energy }) {
  const t = energy.mode === "full" ? "Full power" : energy.mode === "low" ? "Low power" : "Resting";
  return <span className={`powerchip ${energy.mode}`}><Icon name={energy.mode === "full" ? "fire" : energy.mode === "low" ? "battery" : "moon"} size={14} /> {t}</span>;
}

// ── Grown-up? ────────────────────────────────────────────────────────────────────────

export function HelpSheet({ open, onClose, parentLabel, helplines, canMessage = true }: {
  open: boolean; onClose: () => void; parentLabel: string; helplines: Helpline[]; canMessage?: boolean;
}) {
  const [stage, setStage] = useState<"pick" | "write" | "sent" | "failed">("pick");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  const before = useRef<Element | null>(null);
  useEffect(() => { if (open) { setStage("pick"); setText(""); setSending(false); } }, [open]);
  // A real modal <dialog>: focus moves into it, Tab stays inside it, Esc closes it, and focus goes
  // back to whatever opened it.
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      before.current = document.activeElement;
      try { d.showModal(); } catch { d.setAttribute("open", ""); }
      d.querySelector<HTMLElement>("h3")?.focus();
    } else if (!open && d.open) {
      d.close();
      (before.current as HTMLElement | null)?.focus?.();
    }
  }, [open]);
  useEffect(() => () => { (before.current as HTMLElement | null)?.focus?.(); }, []);

  const send = async () => {
    if (sending) return;
    setSending(true);
    try {
      const r = await api<{ ok: boolean }>("/api/help/message-parent", { body: { text } });
      setStage(r.ok ? "sent" : "failed");
    } catch {
      setStage("failed");
    } finally {
      setSending(false);
    }
  };
  const tel = (n: string) => `tel:${n.replace(/\s+/g, "")}`;

  return (
    <dialog ref={ref} className="sheet helpdialog" aria-labelledby="help-title"
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); /* a tap on the backdrop */ }}>
      {open && <>
        <span className="grab" aria-hidden />
        <h3 id="help-title" tabIndex={-1}>You don’t have to sort this alone</h3>
        <span style={{ fontSize: "0.9375rem", lineHeight: 1.5, color: "#5a4a63" }}>Whatever it is, a real person can help. You won’t be in trouble.</span>
        {stage === "pick" && canMessage && (
          <button className="helper parent" onClick={() => setStage("write")}>
            <span className="hic"><Icon name="heart" size={26} /></span><span><b>Message {parentLabel}</b><span className="sub">They get it straight away</span></span>
          </button>
        )}
        {stage === "write" && (
          <div className="stack">
            <textarea className="textarea" style={{ background: "#fff", color: "#2a1d3a", borderColor: "#8a6a88" }} aria-label={`Message to ${parentLabel}`} placeholder="Anything you want to say? (optional)" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} autoFocus />
            <button className="btn ember block" onClick={send} disabled={sending} aria-busy={sending}>{sending ? "Sending…" : `Send to ${parentLabel}`}</button>
          </div>
        )}
        <div role="status">
          {stage === "sent" && <div className="helper parent"><span className="hic"><Icon name="check" size={26} /></span><span><b>Sent</b><span className="sub">{parentLabel} knows you’d like them.</span></span></div>}
          {stage === "failed" && <div className="helper line"><span className="hic"><Icon name="warn" size={26} /></span><span><b>That didn’t send</b><span className="sub">Please go and find {parentLabel}, or call someone below.</span></span></div>}
        </div>
        {helplines.map((h) => (
          <a key={h.name + h.number} className={`helper ${h.kind === "emergency" ? "sos" : "line"}`} href={tel(h.number)}>
            <span className="hic"><Icon name={h.kind === "emergency" ? "siren" : "phone"} size={26} /></span>
            <span><b>{h.name} · {h.number}</b><span className="sub">{h.sub}</span></span>
          </a>
        ))}
        <button className="btn ghost small" style={{ background: "transparent", color: "#5a4a63", borderColor: "#d9c2df" }} onClick={onClose}>Close</button>
      </>}
    </dialog>
  );
}

// ── Markdown (tiny, safe: builds React elements, never HTML strings) ────────────────────────

function inline(s: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|(?<![\w])_[^_]+_(?![\w]))/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const t = m[0];
    out.push(
      t.startsWith("`") ? <code key={`${key}-${i++}`} style={{ fontSize: "0.9em", background: "rgba(217,163,224,0.15)", padding: "1px 5px", borderRadius: 5 }}>{t.slice(1, -1)}</code>
        : t.startsWith("**") ? <b key={`${key}-${i++}`}>{t.slice(2, -2)}</b> : <i key={`${key}-${i++}`}>{t.slice(1, -1)}</i>,
    );
    last = m.index + t.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const blocks = text.replace(/\r/g, "").split(/\n{2,}/);
  return (
    <div className="md">
      {blocks.map((b, i) => {
        const k = `b${i}`;
        const h = /^(#{1,3})\s+(.*)$/.exec(b);
        if (h) {
          const Tag = (`h${h[1].length}` as "h1" | "h2" | "h3");
          return <Tag key={k}>{inline(h[2], k)}</Tag>;
        }
        if (/^>\s?/.test(b)) {
          return <blockquote key={k} style={{ margin: "0 0 0.8em", padding: "6px 12px", borderLeft: "3px solid var(--lilac)", color: "var(--text-3)" }}>{inline(b.replace(/^>\s?/gm, ""), k)}</blockquote>;
        }
        if (/^\s*([-*]|\d+\.)\s+/.test(b)) {
          const items = b.split("\n").filter(Boolean).map((l) => l.replace(/^\s*([-*]|\d+\.)\s+/, ""));
          return <ul key={k}>{items.map((it, j) => <li key={j}>{inline(it, `${k}-${j}`)}</li>)}</ul>;
        }
        return <p key={k}>{b.split("\n").flatMap((line, j) => (j ? [<br key={`br${j}`} />, ...inline(line, `${k}-${j}`)] : inline(line, `${k}-${j}`)))}</p>;
      })}
    </div>
  );
}

export function Toggle({ label, checked, onChange }: { label: React.ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span style={{ flex: 1 }}>{label}</span>
    </label>
  );
}

/** What the companion is doing right now, in a few words (shown under its name). */
export function doingText(state: { energy: Energy; desk: { working: { kind: string; title: string; status?: string } | null; browsing?: { title: string; by: string | null } | null } } | null, mood: string): string {
  const w = state?.desk.working;
  const b = state?.desk.browsing;
  if (state?.energy.mode === "resting") return "resting until the energy tops up";
  if (w) return w.status === "queued" ? `about to make ${w.title}` : w.kind === "story" ? "writing a story" : `making ${w.title}`;
  if (b?.by) return `${b.by} is using its browser`;
  if (b) return b.title ? `reading “${b.title}”` : "looking something up";
  if (mood === "thinking") return "thinking…";
  if (state?.energy.mode === "low") return "on low power, still here to chat";
  return "free to chat";
}
