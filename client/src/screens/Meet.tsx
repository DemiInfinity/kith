import { useState } from "react";
import { api, type Me, type Profile } from "../api";
import { Avatar, LookIcon } from "../components/Avatar";

/** First run: the child names their companion and picks its look. Honest from the first screen. */
export function Meet({ me, onDone }: { me: Me; onDone: (p: Profile) => void }) {
  const [name, setName] = useState(me.profile.name || "Pip");
  const [look, setLook] = useState(me.looks.includes(me.profile.look) ? me.profile.look : me.looks[0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const go = async () => {
    setBusy(true);
    try {
      onDone(await api<Profile>("/api/profile", { method: "PUT", body: { name: name.trim() || "Pip", look, setupDone: true } }));
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="main">
      <div className="screen narrow" style={{ alignItems: "center", textAlign: "center", gap: 16, paddingTop: "calc(30px + var(--safe-top))" }}>
        <span className="hand" style={{ fontSize: 26 }}>hello{me.name ? `, ${me.name}` : ""}</span>
        <Avatar look={look} size={130} variant="ring" />
        <h2 style={{ fontSize: 30, lineHeight: 1.1 }}>What would you like to call me?</h2>
        <input
          className="input" aria-label="Name" value={name} maxLength={24} onChange={(e) => setName(e.target.value)}
          style={{ textAlign: "center", fontFamily: "var(--serif)", fontSize: 26, fontWeight: 600, borderColor: "var(--lilac)", borderWidth: 2, minHeight: 56 }}
        />
        <span style={{ fontSize: 14, color: "var(--muted)" }}>You can change it any time.</span>
        {me.looks.length > 1 && (
          <>
            <b style={{ alignSelf: "flex-start", fontSize: 15 }}>And what should I look like?</b>
            <div className="looks" role="radiogroup" aria-label="Look">
              {me.looks.map((l) => (
                <button key={l} className={`look ${look === l ? "on" : ""}`} role="radio" aria-checked={look === l} aria-label={l} onClick={() => setLook(l)}>
                  <LookIcon look={l} />
                </button>
              ))}
            </div>
          </>
        )}
        {err && <span className="small" style={{ color: "var(--ember)" }}>{err}</span>}
        <button className="btn primary block" style={{ minHeight: 54, fontSize: 17 }} disabled={busy} onClick={go}>That’s me →</button>
        <span className="small">
          I’m an AI, not a person. I live on your family’s home server, and I help {me.parentLabel} keep you safe. I’ll always tell you if I need to tell {me.parentLabel === "your grown-up" ? "them" : me.parentLabel} something.
        </span>
      </div>
    </div>
  );
}
