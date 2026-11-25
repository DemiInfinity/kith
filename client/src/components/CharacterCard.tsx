// A character Pip made or changed in chat, shown under the reply: a small live 3D preview (idling,
// looking around, drag to turn), their name and kind, and "Open in the workshop".
//
// Kept light: the engine loads on first use, a preview only animates while it's on screen, and
// only one preview is live at a time (the others show their picture; tap one to bring it to life).

import { useEffect, useRef, useState } from "react";
import { Pip3D, prefersStill } from "../pip3d/Stage";
import { NEW_CHARACTER, normaliseLook, speciesGuess } from "../pip3d/look";
import { ensureThumb } from "../pip3d/thumbs";
import { useCharacter } from "../lib/characters";
import { openInWorkshop, CharacterThumb } from "../screens/OC";

/** True while the element is on screen. */
function useOnScreen(el: React.RefObject<HTMLElement | null>): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!el.current || typeof IntersectionObserver === "undefined") { setOn(true); return; }
    const io = new IntersectionObserver(([e]) => setOn(e.isIntersecting), { threshold: 0.15 });
    io.observe(el.current);
    return () => io.disconnect();
  }, [el]);
  return on;
}

export function CharacterCard({ id, live, onWake, go }: { id: number; live: boolean; onWake: () => void; go: (to: string) => void }) {
  const c = useCharacter(id);
  const box = useRef<HTMLDivElement>(null);
  const onScreen = useOnScreen(box);
  const [thumb, setThumb] = useState<string | null>(null);
  const [still] = useState(prefersStill);
  useEffect(() => {
    if (!c || c.sheet.thumb) return;
    let gone = false;
    void ensureThumb(c).then((t) => { if (t && !gone) setThumb(t); });
    return () => { gone = true; };
  }, [c]);
  if (c === null) return null; // deleted since
  if (!c) return <div className="charcard" aria-busy="true"><div className="cc-stage" /></div>;
  const look = normaliseLook(c.sheet.model ?? { ...NEW_CHARACTER, name: c.sheet.name.slice(0, 20) });
  const kind = c.sheet.species || speciesGuess(look);
  const picture = <CharacterThumb c={c} size={140} thumb={thumb} />;
  return (
    <div className="charcard">
      <div className="cc-stage" ref={box}>
        {live
          ? <Pip3D look={look} still={still} active={onScreen} label={`${c.sheet.name} in 3D. Drag to turn round.`} fallback={<div className="cc-pic">{picture}</div>} />
          : <button className="cc-pic" onClick={onWake} aria-label={`Show ${c.sheet.name} in 3D`}>{picture}<span className="cc-wake">Tap to see them move</span></button>}
      </div>
      <div className="cc-info">
        <b>{c.sheet.name}</b>
        <span>{[kind, c.sheet.pronouns].filter(Boolean).join(" · ")}</span>
        <button className="btn ghost small" onClick={() => openInWorkshop(c.id, go)}>Open in the workshop</button>
      </div>
    </div>
  );
}
