// Pip's voice made on her Mac (Kith.app, the child's, on Apple silicon): Kokoro, run by the app
// itself (mac/src-tauri/src/voice.rs). In a browser, on the iPhone, in Kith Parent or on an Intel
// Mac none of this runs and calls use the home voice exactly as before.
//
// - The first time it's wanted (a call, or the voice picker) the app fetches the model once
//   ("Getting Pip's new voice ready… 40%"). Until then, or if anything goes wrong, the home voice.
// - Only Pip's reply text is spoken here, a sentence at a time: the first words play while the
//   rest are still being made. Nothing leaves the Mac.
// - The mouth follows the sound the same way as the home voice (playWithMouth).
// - After 15 quiet minutes the app puts the model away to free memory; it comes back (from the
//   files already fetched, in a few seconds) the next time it's wanted.
// - Her choice of voice (six British voices) is kept on this Mac.

import { useSyncExternalStore } from "react";
import { invoke, tauri } from "./native";
import { playWithMouth } from "./audio";

export type VoicePhase = "absent" | "downloading" | "loading" | "ready" | "slow" | "failed" | "unsupported";
export interface VoiceStatus {
  phase: VoicePhase;
  progress: number;
  rtf: number | null;
  voices: { id: string; name: string }[];
}

const OFF: VoiceStatus = { phase: "unsupported", progress: 0, rtf: null, voices: [] };
let status: VoiceStatus = OFF;
let listening = false;
const subs = new Set<() => void>();
const publish = (s: VoiceStatus) => { status = s; for (const f of subs) f(); };

/** Kith.app, the child's: the only place the Mac voice can be. */
export const isChildMacApp = () => typeof window !== "undefined" && tauri() !== null && (window as unknown as { __KITH_APP__?: string }).__KITH_APP__ === "child";

function listen() {
  const t = tauri();
  if (listening || !t || !isChildMacApp()) return;
  listening = true;
  void t.event.listen<VoiceStatus>("kith:voice", (e) => publish(e.payload)).catch(() => undefined);
  void invoke<VoiceStatus>("voice_status").then(publish).catch(() => undefined);
}

export function macVoiceStatus(): VoiceStatus { listen(); return status; }
const subscribe = (f: () => void) => { listen(); subs.add(f); return () => { subs.delete(f); }; };
export function useMacVoice(): VoiceStatus {
  return useSyncExternalStore(subscribe, macVoiceStatus, () => OFF);
}

/** The Mac voice is here or on its way (not on an Intel Mac, and not when this Mac can't keep up). */
export const macVoiceOffered = (s: VoiceStatus) => s.phase !== "unsupported" && s.phase !== "slow" && s.voices.length > 0;

/** Gets the voice ready, fetching it the first time. Safe to call often. */
export function prepareMacVoice() {
  if (!isChildMacApp()) return;
  listen();
  void invoke<VoiceStatus>("voice_prepare").then(publish).catch(() => undefined);
}

/** What the call and the voice picker say while it's coming. Empty when there's nothing to say. */
export function voiceProgressText(s: VoiceStatus, name: string): string {
  if (s.phase === "downloading") return `Getting ${name}’s new voice ready… ${Math.floor(s.progress * 100)}%`;
  if (s.phase === "loading") return `Getting ${name}’s new voice ready…`;
  return "";
}

// ── Her choice of voice ──

export const MAC_VOICES = [
  { id: "bf_emma", name: "Emma" }, { id: "bf_isabella", name: "Isabella" }, { id: "bf_lily", name: "Lily" },
  { id: "bf_alice", name: "Alice" }, { id: "bm_fable", name: "Fable" }, { id: "bm_george", name: "George" },
] as const;
export const DEFAULT_MAC_VOICE = "bf_emma";
const VOICE_KEY = "kith-mac-voice";
export function savedMacVoice(): string {
  try { const v = localStorage.getItem(VOICE_KEY); return MAC_VOICES.some((x) => x.id === v) ? v! : DEFAULT_MAC_VOICE; } catch { return DEFAULT_MAC_VOICE; }
}
export function saveMacVoice(id: string) {
  try { localStorage.setItem(VOICE_KEY, id); } catch { /* fine: for this visit */ }
}

// ── Speaking ──

/** Text for speaking: no emoji or markdown (the same as the home voice's speakable()). */
export function speakable(text: string): string {
  return text
    .replace(/\p{Extended_Pictographic}|\p{Emoji_Modifier}|‍|️/gu, "")
    .replace(/[*_#`>~]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pip's reply, in the pieces it's spoken in: sentences, with very short ones joined to the next
 * (fewer little pauses), and long ones split where there's a natural pause. The first piece is
 * kept short so the first words come quickly.
 */
export function speechChunks(text: string, max = 220): string[] {
  const clean = speakable(text).slice(0, 1500);
  if (!clean) return [];
  // A sentence ends at . ! ? or … followed by a space (so "3.5" stays whole).
  const sentences = clean.match(/.+?(?:[.!?…]+["”’)\]]*(?=\s|$)|$)/g)?.map((s) => s.trim()).filter(Boolean) ?? [clean];
  const pieces: string[] = [];
  for (const s of sentences) {
    if (s.length <= max) { pieces.push(s); continue; }
    // A long sentence: at commas and the like, then at spaces.
    let rest = s;
    while (rest.length > max) {
      const head = rest.slice(0, max);
      const at = Math.max(head.lastIndexOf(", "), head.lastIndexOf("; "), head.lastIndexOf(": "), head.lastIndexOf(" – "), head.lastIndexOf(" — "));
      const cut = at > max / 3 ? at + 1 : head.lastIndexOf(" ") > 0 ? head.lastIndexOf(" ") : max;
      pieces.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) pieces.push(rest);
  }
  // Join tiny pieces ("Oh!" "Yes.") to the next, except the first, which should be quick.
  const out: string[] = [];
  for (const p of pieces) {
    const last = out.at(-1);
    if (last !== undefined && out.length > 1 && last.length < 30 && last.length + p.length + 1 <= max) out[out.length - 1] = `${last} ${p}`;
    else out.push(p);
  }
  return out;
}

const speakPiece = (text: string, voice: string) =>
  invoke<ArrayBuffer>("voice_speak", { text, voice }).then((b) => new Blob([b], { type: "audio/wav" }));

/**
 * Speaks Pip's reply on this Mac. Resolves "here" once it's been spoken (or stopped), or "home"
 * straight away when the Mac voice isn't ready, so the caller uses the home voice instead. Each
 * piece is made while the one before plays.
 */
export async function speakOnMac(text: string, onMouth: (open: number) => void, signal?: AbortSignal, ctx?: AudioContext, voice = savedMacVoice()): Promise<"here" | "home"> {
  if (!isChildMacApp()) return "home";
  const phase = macVoiceStatus().phase;
  // Put away after a quiet while (voice.rs): it comes back for the next reply.
  if (phase === "absent") prepareMacVoice();
  if (phase !== "ready") return "home";
  const pieces = speechChunks(text);
  if (!pieces.length) return "here";
  let next: Promise<Blob> = speakPiece(pieces[0], voice);
  for (let i = 0; i < pieces.length; i++) {
    let wav: Blob;
    try {
      wav = await next;
    } catch {
      // The first piece failed: nothing's been said, so the home voice says it all. Later: stop there.
      return i === 0 ? "home" : "here";
    }
    if (signal?.aborted) return "here";
    if (i + 1 < pieces.length) {
      next = speakPiece(pieces[i + 1], voice);
      next.catch(() => undefined); // handled when it's awaited
    }
    await playWithMouth(wav, onMouth, signal, ctx);
    if (signal?.aborted) return "here";
  }
  return "here";
}
