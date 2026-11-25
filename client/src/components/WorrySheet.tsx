// A worry typed somewhere other than chat (see lib/worry.ts): Pip's kind words, the helplines, and
// a way back to chat, where the same words are waiting. Not an error: nothing is wrong with them.

import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icons";
import { sheetMounted, telHref, WORRY_EVENT, type ToldGrownUp } from "../lib/worry";

export function WorrySheet({ name, goToChat, openHelp }: { name: string; goToChat: () => void; openHelp: () => void }) {
  const [t, setT] = useState<ToldGrownUp | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  const before = useRef<Element | null>(null);
  const help = useRef(openHelp);
  help.current = openHelp;
  useEffect(() => {
    const off = sheetMounted();
    const on = (e: Event) => {
      const told = (e as CustomEvent<ToldGrownUp>).detail;
      setT(told);
      // Something that needs a grown-up now: the Grown-up? sheet opens too, on top, as in chat.
      if (told.level === "now") setTimeout(() => help.current(), 0);
    };
    addEventListener(WORRY_EVENT, on);
    return () => { removeEventListener(WORRY_EVENT, on); off(); };
  }, []);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (t && !d.open) {
      before.current = document.activeElement;
      try { d.showModal(); } catch { d.setAttribute("open", ""); }
      d.querySelector<HTMLElement>("h3")?.focus();
    } else if (!t && d.open) {
      d.close();
      (before.current as HTMLElement | null)?.focus?.();
    }
  }, [t]);
  const close = () => setT(null);
  return (
    <dialog ref={ref} className="sheet helpdialog worrysheet" aria-labelledby="worry-title" aria-describedby="worry-words"
      onCancel={(e) => { e.preventDefault(); close(); }}
      onClick={(e) => { if (e.target === ref.current) close(); }}>
      {t && <>
        <span className="grab" aria-hidden />
        <h3 id="worry-title" tabIndex={-1}>{name} wants to check you’re okay</h3>
        <p id="worry-words" className="worry-words">{t.message}</p>
        {t.childNotice && t.childNotice !== t.message && <p className="worry-notice">{t.childNotice}</p>}
        {t.helplines.map((h) => (
          <a key={h.name + h.number} className="helper line" href={telHref(h.number)}>
            <span className="hic"><Icon name="phone" size={26} /></span>
            <span><b>{h.name}</b><span className="sub worry-number">{h.number}</span></span>
          </a>
        ))}
        {t.openChat && <button className="btn ember block" onClick={() => { close(); goToChat(); }}>Go to chat</button>}
        <button className="btn ghost small" style={{ background: "transparent", color: "#5a4a63", borderColor: "#d9c2df" }} onClick={close}>Close</button>
      </>}
    </dialog>
  );
}
