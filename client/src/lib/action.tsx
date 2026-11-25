// Taps that change something (save, remove, pin…) shouldn't fail silently. `action(fn)` wraps an
// async handler so that if it throws, a short toast says what went wrong; <Toaster /> shows it.

import { useCallback, useEffect, useRef, useState } from "react";
import { isAbort } from "../api";
import { isToldGrownUp } from "./worry";

const EVENT = "kith-toast";

/** Shows a short message at the bottom of the screen for a few seconds. */
export function toast(text: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: text }));
}

/** The words for a failure: the server's own (already friendly) message, or a gentle fallback. */
export function failureWords(e: unknown, what?: string): string {
  const m = (e as Error)?.message?.trim();
  const lead = what ? `Couldn’t ${what}. ` : "";
  return m ? `${lead}${m}` : `${lead || "That didn’t work. "}Try again in a moment.`;
}

/** Wraps an async handler: any failure (except a deliberate abort) becomes a toast. */
export function action<A extends unknown[]>(fn: (...args: A) => Promise<unknown> | unknown, what?: string): (...args: A) => void {
  return (...args: A) => {
    try {
      // A worry the grown-up was told about already has its own sheet: no toast on top.
      void Promise.resolve(fn(...args)).catch((e) => { if (!isAbort(e) && !isToldGrownUp(e)) toast(failureWords(e, what)); });
    } catch (e) {
      if (!isToldGrownUp(e)) toast(failureWords(e, what));
    }
  };
}

/** The hook form, for components: `const run = useAction(); onClick={run(async () => …)}`. */
export function useAction() {
  return useCallback(action, []);
}

/** How long a toast stays: longer for longer messages (about 15 characters a second), 6–15 seconds. */
export function toastMs(text: string): number {
  return Math.min(15_000, Math.max(6_000, 3_000 + text.length * 65));
}

/** Where toasts appear. One per app. A toast waits while the pointer is over it or it has focus. */
export function Toaster() {
  const [text, setText] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // How much time is left, and when the current countdown started (so pausing can keep the rest).
  const left = useRef(0);
  const since = useRef(0);
  const held = useRef({ hover: false, focus: false });
  const run = useCallback(() => {
    clearTimeout(timer.current);
    since.current = Date.now();
    timer.current = setTimeout(() => setText(""), left.current);
  }, []);
  const pause = useCallback((why: "hover" | "focus") => {
    if (!held.current.hover && !held.current.focus && timer.current !== undefined) {
      clearTimeout(timer.current);
      timer.current = undefined;
      left.current = Math.max(1_500, left.current - (Date.now() - since.current));
    }
    held.current[why] = true;
  }, []);
  const resume = useCallback((why: "hover" | "focus") => {
    held.current[why] = false;
    if (!held.current.hover && !held.current.focus && timer.current === undefined) run();
  }, [run]);
  useEffect(() => {
    const on = (e: Event) => {
      const t = (e as CustomEvent<string>).detail;
      setText(t);
      left.current = toastMs(t);
      if (held.current.hover || held.current.focus) { clearTimeout(timer.current); timer.current = undefined; } else run();
    };
    addEventListener(EVENT, on);
    return () => { removeEventListener(EVENT, on); clearTimeout(timer.current); };
  }, [run]);
  const dismiss = () => { clearTimeout(timer.current); timer.current = undefined; held.current = { hover: false, focus: false }; setText(""); };
  return (
    <div className="toastwrap" role="alert" aria-live="assertive">
      {text && (
        <div className="toast" onMouseEnter={() => pause("hover")} onMouseLeave={() => resume("hover")}
          onFocus={() => pause("focus")} onBlur={() => resume("focus")}>
          <span>{text}</span>
          <button type="button" className="x" aria-label="Dismiss" onClick={dismiss}>✕</button>
        </div>
      )}
    </div>
  );
}
