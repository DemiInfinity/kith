// Polling that rests while Kith isn't on screen: nothing is fetched while the page is hidden
// (a phone in a pocket, a Mac window behind others), and it refreshes straight away when it's back.

import { useEffect, useRef } from "react";

function hidden(): boolean {
  return typeof document !== "undefined" && document.hidden;
}

/** Calls `fn` every `ms` while the page is visible, and once as soon as it becomes visible again.
 *  Returns a function that stops it. `immediate` runs it once at the start. */
export function pollWhileVisible(fn: () => unknown, ms: number, immediate = true): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  const tick = () => { if (!hidden()) void fn(); };
  const start = () => { if (!timer) timer = setInterval(tick, ms); };
  const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
  const onVisibility = () => {
    if (hidden()) stop();
    else { void fn(); start(); }
  };
  if (immediate && !hidden()) void fn();
  if (!hidden()) start();
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
  return () => {
    stop();
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
  };
}

/** The hook form: polls `fn` every `ms` while visible. Pass `ms` as null to pause it. */
export function usePoll(fn: () => unknown, ms: number | null, immediate = true): void {
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => {
    if (ms === null) return;
    return pollWhileVisible(() => latest.current(), ms, immediate);
  }, [ms, immediate]);
}
