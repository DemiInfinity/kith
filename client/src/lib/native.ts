// The Mac app (mac/): when Kith runs inside it, the page can use a few parts of the Mac.
// In a normal browser none of this runs (isMacApp() is false) and nothing changes.
//
// - Notifications: polls the server's inbox and shows each one as a Mac notification.
// - Calendar & Reminders: while she shares them (Kith menu), sends the coming week to the server
//   every 10 minutes; Pip's requests to add things are shown to her as native "Add / Not now"
//   prompts by the app itself.
// - ⌃⌥Space (or Call Pip in the menu bar) opens a call.
// - A document dropped on the window is handed to the chat (a "kith-file" event on window).

import { pollWhileVisible } from "./poll";
import { api } from "../api";

type Tauri = {
  core: { invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> };
  event: { listen<T>(event: string, cb: (e: { payload: T }) => void): Promise<() => void> };
};

export type SharedFile = { name: string; text: string; truncated: boolean };
export type NativeInfo = { app: string; version: string; shareCalendar: boolean; calendar: string; reminders: string; callShortcut: string; fileKinds: string[] };
type Action =
  | { id: number; kind: "event"; title: string; start: number; end: number | null; allDay: boolean }
  | { id: number; kind: "reminder"; title: string; due: number | null };

function tauri(): Tauri | null {
  const t = (window as unknown as { __TAURI__?: Tauri }).__TAURI__;
  return t?.core?.invoke ? t : null;
}

export const isMacApp = () => tauri() !== null;

export function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const t = tauri();
  return t ? t.core.invoke<T>(cmd, args) : Promise.reject(new Error("Only in the Kith Mac app."));
}

export const nativeInfo = () => invoke<NativeInfo>("native_info");

/** Opens the Mac's file picker. `null` if she cancelled. */
export const pickDocument = () => invoke<SharedFile | null>("native_pick_document");

let started = false;
let actionsBusy = false;

/** Shows Pip's requests to add things (each as a native prompt) and reports what she chose. */
export async function checkNativeActions() {
  if (!isMacApp() || actionsBusy) return;
  actionsBusy = true;
  try {
    const { actions } = await api<{ actions: Action[] }>("/api/native/actions");
    for (const a of actions) {
      let result: "added" | "declined" | "failed";
      try {
        const yes = a.kind === "event"
          ? await invoke<boolean>("native_add_event", { event: { title: a.title, start: a.start, end: a.end, allDay: a.allDay } })
          : await invoke<boolean>("native_add_reminder", { reminder: { title: a.title, due: a.due } });
        result = yes ? "added" : "declined";
      } catch {
        result = "failed";
      }
      await api(`/api/native/actions/${a.id}`, { body: { result } }).catch(() => undefined);
    }
  } catch {
    /* offline for a moment: next time */
  } finally {
    actionsBusy = false;
  }
}

async function syncCalendar() {
  try {
    const snap = await invoke<{ events: unknown[]; reminders: unknown[] } | null>("native_calendar_snapshot");
    if (snap) await api("/api/native/calendar", { method: "PUT", body: snap });
    else await api("/api/native/calendar", { method: "DELETE" });
  } catch {
    /* offline for a moment: next time */
  }
}

/** Call once, for the child, when the app has loaded. `go` opens a screen. */
export function startNative(go: (to: string) => void) {
  const t = tauri();
  if (!t || started) return;
  started = true;

  // Notifications: the first poll only learns where the inbox is up to.
  let last: number | null = null;
  const poll = async () => {
    try {
      const r = await api<{ items: { title: string; body: string }[]; last: number }>(`/api/native/inbox${last === null ? "" : `?after=${last}`}`);
      for (const n of r.items) await invoke("native_notify", { title: n.title, body: n.body }).catch(() => undefined);
      last = r.last;
    } catch {
      /* offline for a moment */
    }
  };
  // The notification inbox keeps going while the window is hidden or closed: that's when a Mac
  // notification is most useful. Calendar sync and the actions check rest until Kith is on screen.
  void poll();
  setInterval(poll, 30_000);

  pollWhileVisible(syncCalendar, 10 * 60_000);
  pollWhileVisible(checkNativeActions, 30_000, false);

  void t.event.listen("kith:calendar", () => void syncCalendar());
  void t.event.listen("kith:call", () => go("/talk"));
  void t.event.listen<{ ok: boolean; file?: SharedFile; error?: string }>("kith:file", (e) => {
    window.dispatchEvent(new CustomEvent("kith-file", { detail: e.payload }));
  });
}
