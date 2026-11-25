// Taps that change something (save, remove, pin…) shouldn't fail silently. `action(fn)` wraps an
// async handler so that if it throws, a short toast says what went wrong; <Toaster /> shows it.

import { useCallback, useEffect, useState } from "react";
import { isAbort } from "../api";

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
      void Promise.resolve(fn(...args)).catch((e) => { if (!isAbort(e)) toast(failureWords(e, what)); });
    } catch (e) {
      toast(failureWords(e, what));
    }
  };
}

/** The hook form, for components: `const run = useAction(); onClick={run(async () => …)}`. */
export function useAction() {
  return useCallback(action, []);
}

/** Where toasts appear. One per app. */
export function Toaster() {
  const [text, setText] = useState("");
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const on = (e: Event) => {
      setText((e as CustomEvent<string>).detail);
      clearTimeout(t);
      t = setTimeout(() => setText(""), 6000);
    };
    addEventListener(EVENT, on);
    return () => { removeEventListener(EVENT, on); clearTimeout(t); };
  }, []);
  return (
    <div className="toastwrap" role="alert" aria-live="assertive">
      {text && (
        <div className="toast">
          <span>{text}</span>
          <button type="button" className="x" aria-label="Dismiss" onClick={() => setText("")}>✕</button>
        </div>
      )}
    </div>
  );
}
