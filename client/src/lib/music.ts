// Pip listens along (Kith.app, the child's, only): the Mac app says when Apple Music or Spotify is
// playing (mac/src-tauri/src/music.rs). In a browser, on the iPhone and in Kith Parent nothing is
// detected and nothing changes.
//
// - Only "playing or not" by default. "Let Pip know what song is playing" (Settings › Notifications,
//   off to start with, kept on this Mac) adds the title and artist.
// - While it plays, Pip wears headphones for a bit (a look on top, never saved), its status says
//   "listening to music with you", and each chat turn tells the server, for that turn's prompt
//   only (the server never stores it).

import { useSyncExternalStore } from "react";
import { invoke, tauri } from "./native";

export interface MusicNow { playing: boolean; title?: string; artist?: string }

const SONGS_KEY = "kith-music-songs";
/** "Let Pip know what song is playing": off unless she's switched it on. */
export function songsAllowed(): boolean {
  try { return localStorage.getItem(SONGS_KEY) === "on"; } catch { return false; }
}

const QUIET: MusicNow = { playing: false };
let now: MusicNow = QUIET;
let started = false;
const subs = new Set<() => void>();
function publish(n: MusicNow) {
  const next = tidy(n, songsAllowed());
  if (next.playing === now.playing && next.title === now.title && next.artist === now.artist) return;
  now = next;
  for (const f of subs) f();
}

/** Only what she allows: the song's name goes when she's switched it on, never otherwise. */
export function tidy(n: MusicNow | null | undefined, songs: boolean): MusicNow {
  if (!n?.playing) return QUIET;
  if (!songs) return { playing: true };
  const clip = (s?: string) => (typeof s === "string" && s.trim() ? s.trim().slice(0, 120) : undefined);
  const title = clip(n.title), artist = clip(n.artist);
  return { playing: true, ...(title ? { title } : {}), ...(title && artist ? { artist } : {}) };
}

const isChildApp = () => (window as unknown as { __KITH_APP__?: string }).__KITH_APP__ === "child";

/** Starts listening along (the child's Mac app only; once). */
export function startMusic() {
  const t = tauri();
  if (started || !t || !isChildApp()) return;
  started = true;
  void t.event.listen<MusicNow>("kith:music", (e) => publish(e.payload)).catch(() => undefined);
  void invoke<MusicNow>("music_watch", { songs: songsAllowed() }).then(publish).catch(() => undefined);
}

export function setSongsAllowed(on: boolean) {
  try { localStorage.setItem(SONGS_KEY, on ? "on" : "off"); } catch { /* fine: for this visit */ }
  publish(now.playing ? { playing: true } : QUIET); // forget the song's name straight away
  if (started) void invoke<MusicNow>("music_watch", { songs: on }).then(publish).catch(() => undefined);
}

export const musicNow = () => now;
export const subscribeMusic = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export function useMusic(): MusicNow {
  return useSyncExternalStore(subscribeMusic, musicNow, () => QUIET);
}

/** What a chat turn tells the server: nothing unless music is playing. */
export function musicForTurn(): MusicNow | undefined {
  return now.playing ? tidy(now, songsAllowed()) : undefined;
}

/** The status line's words, e.g. "listening to music with you". */
export function musicWords(m: MusicNow | null | undefined): string {
  if (!m?.playing) return "";
  return m.title ? `listening to “${m.title}” with you` : "listening to music with you";
}
