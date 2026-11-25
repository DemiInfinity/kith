// A call, kept apart from the call screen so it carries on while she looks at other pages (the
// mini call). The call screen (screens/Talk.tsx) and the mini call are views of this; App.tsx's
// CallProvider makes one for the child's app and ends it when the app goes.
//
// Privacy is as before: the microphone's audio is held in memory for a turn and sent only to the
// family's own speech-to-text; nothing new is stored. Hands-free never listens while Pip is talking
// (or thinking), or while she's muted: those frames are ignored, not kept.

import { api, isAbort, type Mood, type Turn } from "../api";
import type { PipStage } from "../pip3d/engine";
import { audioContextFromTap, joinPcm, MicStream, playWithMouth } from "./audio";
import { savedCallMode, saveCallMode, type CallMode, type CallPhase, type Ear } from "./call";
import { playHangUp } from "./sounds";
import { HANDS_FREE, TAP_TO_TALK, Vad, type VadEvent } from "./vad";

export interface CallSnap {
  /** A call is on: from opening the call until End (or Pip hanging up and her leaving). */
  active: boolean;
  phase: CallPhase;
  mood: Mood;
  heard: string;
  said: string;
  err: string;
  secs: number;
  noVoice: boolean;
  mode: CallMode;
  muted: boolean;
  ear: Ear;
  /** The Mac app's own mini window is showing the call: the 3D views in this window rest. */
  elsewhere: boolean;
}

export interface CallDeps {
  name: string;
  lowEnergy: boolean;
  onTurn: (t: Turn) => void;
  openHelp: () => void;
}

type Levels = { mouth: number; level: number };

export class CallSession {
  private snap: CallSnap;
  private levels: Levels = { mouth: 0, level: 0 };
  private subs = new Set<() => void>();
  private levelSubs = new Set<() => void>();
  deps: CallDeps = { name: "Pip", lowEnergy: false, onTurn: () => {}, openHelp: () => {} };

  private ctrl = new AbortController();
  private stopPlay: AbortController | null = null;
  private audio: AudioContext | null = null;
  private mic: MicStream | null = null;
  private micStarting: Promise<boolean> | null = null;
  private vad = new Vad(HANDS_FREE);
  /** Which kind of listening the open mic is doing. */
  private vadFor: CallMode | null = null;
  private lastLevelAt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private fakeMouth: ReturnType<typeof setInterval> | null = null;
  /** "Grown-up?" opened during this call: then the companion won't hang up (the server checks too). */
  private helpOpened = false;
  private stages = new Map<PipStage, boolean>();

  constructor() {
    this.snap = {
      active: false, phase: "idle", mood: "happy", heard: "", said: "", err: "", secs: 0, noVoice: false,
      mode: savedCallMode(), muted: false, ear: "off", elsewhere: false,
    };
  }

  // ── For React (useSyncExternalStore) ──
  get = () => this.snap;
  getLevels = () => this.levels;
  subscribe = (f: () => void) => { this.subs.add(f); return () => { this.subs.delete(f); }; };
  subscribeLevels = (f: () => void) => { this.levelSubs.add(f); return () => { this.levelSubs.delete(f); }; };

  private set(p: Partial<CallSnap>) {
    this.snap = { ...this.snap, ...p };
    for (const f of this.subs) f();
    if ("phase" in p || "muted" in p || "mode" in p || "active" in p) this.syncGate();
  }
  private setLevels(p: Partial<Levels>) {
    if ((p.mouth === undefined || p.mouth === this.levels.mouth) && (p.level === undefined || p.level === this.levels.level)) return;
    this.levels = { ...this.levels, ...p };
    for (const f of this.levelSubs) f();
  }

  /** A 3D Pip showing the call: its mouth follows the voice (not with reduced motion: captions carry it). */
  addStage(stage: PipStage, still: boolean): () => void {
    this.stages.set(stage, still);
    return () => { this.stages.delete(stage); };
  }
  private mouth(v: number) {
    this.setLevels({ mouth: v });
    for (const [s, still] of this.stages) if (!still) s.setMouth(v);
  }

  /** The Mac app's mini window is (or isn't) showing the call. */
  setElsewhere(v: boolean) { if (v !== this.snap.elsewhere) this.set({ elsewhere: v }); }

  private moodNow(): Mood { return this.deps.lowEnergy ? "sleepy" : "happy"; }

  // ── The call ──

  /** Opening the call screen: starts a call if there isn't one. Hands-free starts listening if the browser lets it without a tap. */
  open() {
    if (this.snap.active) return;
    this.ctrl = new AbortController();
    this.helpOpened = false;
    this.vad = new Vad(HANDS_FREE);
    this.set({ active: true, phase: "idle", mood: this.moodNow(), heard: "", said: "", err: "", secs: 0, noVoice: false, muted: false, ear: "off" });
    this.startClock();
    if (this.snap.mode === "handsfree") void this.autoStart();
  }

  /** End: stops everything at once, with the soft "call ended" sound (not when the app itself goes: `sound` false). */
  end(sound = true) {
    this.hangUp(sound);
    this.stopClock();
    this.set({ active: false, phase: "idle", ear: "off", muted: false, heard: "", said: "", err: "", noVoice: false });
  }

  /** The companion said goodbye: the call ends here, gently, with a way to call again. */
  private pipHungUp() {
    this.hangUp(true);
    this.stopClock();
    this.set({ phase: "ended", ear: "off", err: "", mood: this.moodNow() });
  }

  callAgain() {
    this.ctrl = new AbortController();
    this.helpOpened = false;
    this.vad = new Vad(HANDS_FREE);
    this.set({ phase: "idle", secs: 0, heard: "", said: "", err: "", ear: "off", muted: false });
    this.startClock();
    if (this.snap.mode === "handsfree") void this.startHandsFree();
  }

  askHelp() {
    this.helpOpened = true;
    this.deps.openHelp();
  }

  /** The big mic button (a tap: the browser lets the call record and play from here). */
  micTap() {
    const s = this.snap;
    if (!s.active || s.phase === "ended" || s.phase === "hearing" || s.phase === "thinking") return;
    this.audio = audioContextFromTap(this.audio);
    if (s.muted) this.set({ muted: false });
    if (s.phase === "listening") { void this.send(this.vad.take()); return; }
    // Tapping while Pip talks stops its voice (and then it doesn't hang up: she's still talking).
    if (s.phase === "speaking") this.stopPlay?.abort();
    if (s.mode === "tap") { void this.listenTap(); return; }
    // Hands-free: a tap starts her turn now (and opens the mic the first time).
    void this.startHandsFree(true);
  }

  toggleMute() {
    const muted = !this.snap.muted;
    if (muted && this.snap.phase === "listening") {
      // Muted mid-turn: what she'd said so far is thrown away, not sent.
      this.vad.take();
      this.set({ muted, phase: "idle" });
    } else {
      this.set({ muted });
    }
    if (muted) this.closeMic();
    else if (this.snap.mode === "handsfree" && this.audio) void this.startHandsFree();
  }

  /** The Hands-free / Tap to talk switch (a tap, so the mic can start from here). */
  setMode(mode: CallMode) {
    if (mode === this.snap.mode) return;
    saveCallMode(mode);
    if (this.snap.phase === "listening") this.vad.take();
    this.closeMic();
    this.set({ mode, ear: "off", phase: this.snap.phase === "listening" ? "idle" : this.snap.phase });
    if (mode === "handsfree" && this.snap.active && this.snap.phase !== "ended" && !this.snap.muted) {
      this.audio = audioContextFromTap(this.audio);
      void this.startHandsFree();
    }
  }

  // ── Inside ──

  private startClock() {
    this.stopClock();
    this.timer = setInterval(() => this.set({ secs: this.snap.secs + 1 }), 1000);
  }
  private stopClock() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private hangUp(sound = false) {
    this.ctrl.abort();
    this.stopPlay?.abort();
    this.closeMic();
    this.vad = new Vad(HANDS_FREE);
    this.stopFakeMouth();
    // The sound only plays if the call's audio was ever running (a call that never connected is silent),
    // and only once: the context goes with it.
    const ctx = this.audio;
    this.audio = null;
    const ms = sound ? playHangUp(ctx) : 0;
    if (ctx) setTimeout(() => void ctx.close().catch(() => undefined), ms);
    this.mouth(0);
  }

  private closeMic() {
    this.mic?.stop();
    this.mic = null;
    this.micStarting = null;
    this.vadFor = null;
    this.vad.setGate(true, performance.now());
    this.setLevels({ level: 0 });
    if (this.snap.ear !== "off" && this.snap.ear !== "start") this.set({ ear: this.snap.mode === "handsfree" ? "start" : "off" });
  }

  /** Opens the mic (once; it stays open across hands-free turns). False if it isn't allowed. */
  private openMic(kind: CallMode): Promise<boolean> {
    if (this.mic?.open) return Promise.resolve(true);
    if (this.micStarting) return this.micStarting;
    const sig = this.ctrl.signal;
    const ctx = this.audio ?? audioContextFromTap(null);
    this.audio = ctx;
    const m = new MicStream();
    this.mic = m;
    this.vad = new Vad(kind === "handsfree" ? HANDS_FREE : TAP_TO_TALK);
    this.vadFor = kind;
    m.onFrame = (samples, rms) => this.onFrame(samples, rms);
    this.micStarting = m.start(ctx).then(() => {
      this.micStarting = null;
      if (sig.aborted || this.mic !== m) { m.stop(); return false; }
      return true;
    }, () => {
      this.micStarting = null;
      if (this.mic === m) this.mic = null;
      if (!sig.aborted) this.set({ err: "I can’t hear you: the microphone isn’t allowed. You can type instead.", phase: "idle", ear: "off" });
      return false;
    });
    return this.micStarting;
  }

  /** The call opened in hands-free: start listening if the browser allows it without a tap. */
  private async autoStart() {
    let ctx: AudioContext;
    try { ctx = new AudioContext(); } catch { this.set({ ear: "start" }); return; }
    this.audio = ctx;
    await Promise.race([ctx.resume().catch(() => undefined), new Promise((r) => setTimeout(r, 400))]);
    if (this.audio !== ctx) return;
    if (ctx.state === "running") void this.startHandsFree();
    else this.set({ ear: "start" }); // needs a tap first (iOS, or a call opened by ⌃⌥Space)
  }

  private async startHandsFree(now = false) {
    if (this.snap.muted || this.snap.mode !== "handsfree") return;
    if (!this.mic?.open || this.vadFor !== "handsfree") {
      if (this.vadFor !== "handsfree") this.closeMic();
      this.set({ ear: "ready" });
      const ok = await this.openMic("handsfree");
      if (!ok || this.snap.mode !== "handsfree" || this.snap.muted) return;
    }
    this.syncGate();
    if (now && (this.snap.phase === "idle" || this.snap.phase === "speaking")) this.beginTurn();
  }

  /** Tap to talk: the mic opens for this turn, as before. */
  private async listenTap() {
    this.set({ err: "" });
    this.closeMic();
    const ok = await this.openMic("tap");
    if (!ok || this.snap.mode !== "tap") return;
    this.beginTurn();
  }

  private beginTurn() {
    this.vad.forceStart(performance.now());
    this.set({ phase: "listening", mood: this.moodNow(), err: "" });
  }

  /** Hands-free listens only while she's on the call, not muted, and nothing else is going on. */
  private syncGate() {
    const s = this.snap;
    if (s.mode !== "handsfree") return;
    if (!this.mic?.open) return;
    const listen = s.active && !s.muted && s.phase === "idle";
    if (s.phase === "listening") return; // a turn is being captured
    this.vad.setGate(!listen, performance.now());
    const ear: Ear = listen ? (this.vad.state === "calibrating" ? "ready" : "open") : s.ear === "start" ? "start" : "open";
    if (ear !== s.ear) this.set({ ear });
  }

  private onFrame(samples: Float32Array, rms: number) {
    const ev: VadEvent = this.vad.frame(rms, performance.now(), samples);
    const capturing = this.vad.inTurn || this.snap.phase === "listening";
    // Her tile glows with her voice (at most ~30 times a second: it's only a glow).
    const now = performance.now();
    if (now - this.lastLevelAt > 33 || ev) {
      this.lastLevelAt = now;
      this.setLevels({ level: capturing || this.vad.state === "waiting" ? rms : 0 });
    }
    if (this.snap.ear === "ready" && this.vad.state === "waiting") this.set({ ear: "open" });
    if (ev === "start") this.set({ phase: "listening", mood: this.moodNow(), err: "" });
    else if (ev === "end" || ev === "max") void this.send(this.vad.take());
    else if (ev === "drop") { this.vad.take(); this.setLevels({ level: 0 }); this.set({ phase: "idle" }); }
  }

  /** Her turn, sent exactly as before: speech-to-text at home, then the chat, then Pip's voice. */
  private async send(chunks: Float32Array[]) {
    const rate = this.mic?.sampleRate ?? this.audio?.sampleRate ?? 48000;
    const sig = this.ctrl.signal;
    if (this.snap.mode === "tap") this.closeMic();
    this.setLevels({ level: 0 });
    this.set({ phase: "hearing", mood: "thinking" });
    const tapHint = this.snap.mode === "tap" ? " Tap the mic and try again?" : " Say it again?";
    try {
      const pcm = joinPcm(chunks, rate);
      if (pcm.byteLength < 3200) { this.set({ phase: "idle", mood: this.moodNow(), err: `I didn’t catch that.${tapHint}` }); return; }
      const { text } = await api<{ text: string }>("/api/voice/stt", { raw: pcm, signal: sig });
      if (sig.aborted) return;
      if (!text) { this.set({ phase: "idle", mood: this.moodNow(), err: `I didn’t catch that.${tapHint}` }); return; }
      this.set({ heard: text, said: "", phase: "thinking" });
      const turn = await api<Turn>("/api/chat", { body: { text, mode: "talk", call: { helpOpened: this.helpOpened } }, signal: sig });
      // The reply is saved on the server either way; it's shown in the chat if the call has ended.
      this.deps.onTurn(turn);
      if (sig.aborted) return;
      this.set({ said: turn.reply.text, mood: turn.mood });
      if (turn.openHelp) this.askHelp();
      const play = new AbortController();
      this.stopPlay = play;
      this.set({ phase: "speaking" });
      try {
        const wav = await api<Blob>("/api/voice/tts", { body: { messageId: turn.reply.id }, signal: sig });
        if (sig.aborted) return;
        await playWithMouth(wav, (v) => this.mouth(v), play.signal, this.audio ?? undefined);
      } catch {
        if (sig.aborted) return;
        // No voice: show the reply and "talk" it for a moment so it still feels like a call.
        this.set({ err: "My voice isn’t working right now, so I’ve written it instead.", noVoice: true });
        this.startFakeMouth();
        await new Promise<void>((r) => {
          const t = setTimeout(r, Math.min(6000, 600 + turn.reply.text.length * 45));
          const stop = () => { clearTimeout(t); r(); };
          sig.addEventListener("abort", stop, { once: true });
          play.signal.addEventListener("abort", stop, { once: true });
        });
        this.stopFakeMouth();
        if (sig.aborted) return;
        this.set({ noVoice: false });
      }
      if (sig.aborted) return;
      if (turn.endCall && !play.signal.aborted && !this.helpOpened) { this.pipHungUp(); return; }
      if (play.signal.aborted) return; // she started talking again: micTap has the call now
      // Pip's voice has finished: hands-free listens again from here.
      this.set({ phase: "idle" });
    } catch (e) {
      if (sig.aborted || isAbort(e)) return;
      this.set({
        err: (e as Error).message.includes("Voice service") ? "Voices aren’t set up at home yet. You can type instead." : (e as Error).message,
        phase: "idle", mood: "happy",
      });
    }
  }

  private startFakeMouth() {
    this.stopFakeMouth();
    let i = 0;
    this.fakeMouth = setInterval(() => this.mouth([0.2, 0.7, 0.45, 0, 0.9, 0.35][i++ % 6]), 140);
  }
  private stopFakeMouth() {
    if (this.fakeMouth) clearInterval(this.fakeMouth);
    this.fakeMouth = null;
    if (this.levels.mouth) this.mouth(0);
  }
}
