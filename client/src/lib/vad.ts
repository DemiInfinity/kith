// Noticing when she starts and stops talking, from the microphone's loudness alone (no speech
// recognition here, nothing kept). Pure: it's given each small frame of audio with its time, and
// says when a turn starts and ends, so it can be tested without a microphone.
//
// - The first second of listening learns how loud the room is (the noise floor); after that the
//   floor follows the room slowly while she isn't talking.
// - Speech starts when it's clearly louder than the floor for a moment (attack). The ~300 ms just
//   before that is kept too (pre-roll), so the first word isn't clipped.
// - The turn ends after ~900 ms of quiet, or at the longest turn the server takes.
// - While the gate is shut (Pip is talking, she's muted, or Kith is busy with her last turn) every
//   frame is ignored and nothing is kept: Kith never listens to itself through the speakers.
// - Tap to talk uses the same thing: forceStart() begins a turn straight away, and it ends after
//   some speech and a quiet pause, as before.

/** The server takes two minutes of audio at most (routes.ts, /api/voice/stt); stop a little before. */
export const MAX_TURN_MS = 115_000;

export interface VadOptions {
  /** How long the first listen learns the room's noise. */
  calibrateMs: number;
  /** Audio kept from just before speech was noticed. */
  preRollMs: number;
  /** Quiet that ends a turn. */
  silenceMs: number;
  /** The longest turn. */
  maxTurnMs: number;
  /** How long it has to be loud before it counts as speech (a click or a cough doesn't). */
  attackMs: number;
  /** A turn with less speech than this is dropped (a bump or a door), not sent. */
  minSpeechMs: number;
  /** Speech is this many times louder than the floor… */
  startFactor: number;
  /** …and never quieter than this (RMS, 0 to 1). */
  minStart: number;
  /** Still talking while above this many times the floor (lower than the start, so a soft word doesn't end it). */
  endFactor: number;
  minEnd: number;
  /** After the gate opens again, a moment to let the room settle (the end of Pip's voice, an echo). */
  resumeHoldMs: number;
  /** A turn started by a tap that hears nothing for this long is dropped. */
  forcedWaitMs: number;
}

export const HANDS_FREE: VadOptions = {
  calibrateMs: 1000, preRollMs: 300, silenceMs: 900, maxTurnMs: MAX_TURN_MS, attackMs: 120, minSpeechMs: 250,
  startFactor: 3, minStart: 0.02, endFactor: 1.8, minEnd: 0.012, resumeHoldMs: 250,
  forcedWaitMs: 10_000,
};
/** Tap to talk: as it was (it waits for some speech, then ~1.2 s of quiet sends it). */
export const TAP_TO_TALK: VadOptions = { ...HANDS_FREE, silenceMs: 1200, forcedWaitMs: Infinity };

export type VadState = "calibrating" | "waiting" | "speech" | "gated";
/** "start": a turn began. "end": it finished (send it). "max": it hit the longest turn (send it). "drop": too short, thrown away. */
export type VadEvent = "start" | "end" | "max" | "drop" | null;

type Chunk = { t: number; samples: Float32Array | null };

export class Vad {
  readonly opts: VadOptions;
  private st: VadState = "gated";
  private floor = 0.01;
  private calibrated = false;
  private cal: number[] = [];
  private env = 0;
  private lastT = 0;
  private calFrom = 0;
  private holdUntil = 0;
  private loudSince = 0;
  private quietSince = 0;
  private turnFrom = 0;
  private firstLoud = 0;
  private lastLoud = 0;
  /** Tap to talk: started by hand, so it only ends on quiet once she's said something. */
  private forced = false;
  private heard = false;
  private pre: Chunk[] = [];
  private turn: Chunk[] = [];

  constructor(opts: Partial<VadOptions> = {}) {
    this.opts = { ...HANDS_FREE, ...opts };
  }

  get state(): VadState { return this.st; }
  get noiseFloor(): number { return this.floor; }
  get startLevel(): number { return Math.max(this.opts.minStart, this.floor * this.opts.startFactor); }
  get endLevel(): number { return Math.max(this.opts.minEnd, this.floor * this.opts.endFactor); }
  /** Capturing a turn right now. */
  get inTurn(): boolean { return this.st === "speech"; }

  /**
   * Shut (true) while Pip talks, she's muted, or Kith is busy: everything is ignored and anything
   * being collected is thrown away. Open (false) to listen again.
   */
  setGate(shut: boolean, now: number) {
    if (shut) {
      this.st = "gated";
      this.reset();
      return;
    }
    if (this.st !== "gated") return;
    this.reset();
    if (!this.calibrated) { this.st = "calibrating"; this.calFrom = now; this.cal = []; }
    else { this.st = "waiting"; this.holdUntil = now + this.opts.resumeHoldMs; }
  }

  /** Tap to talk (or a tap in hands-free): a turn starts now, whatever the level. */
  forceStart(now: number) {
    this.reset();
    this.st = "speech";
    this.forced = true;
    this.turnFrom = now;
  }

  /** One frame of microphone audio: its loudness (RMS) and when it was heard (ms). */
  frame(raw: number, now: number, samples: Float32Array | null = null): VadEvent {
    // The level rises at once but falls away smoothly (~60 ms), so the tiny gaps inside a word
    // don't count as quiet.
    const dt = this.lastT ? Math.max(0, now - this.lastT) : 0;
    this.lastT = now;
    this.env = Math.max(raw, this.env * Math.exp(-dt / 60));
    const rms = this.env;
    switch (this.st) {
      case "gated":
        return null;
      case "calibrating": {
        this.cal.push(raw);
        this.keepPre({ t: now, samples });
        if (now - this.calFrom >= this.opts.calibrateMs) {
          // A low percentile, not the average: if she starts talking straight away, her voice
          // doesn't teach it that the room is loud.
          const sorted = [...this.cal].sort((a, b) => a - b);
          this.floor = clampFloor(sorted.length ? sorted[Math.floor(sorted.length * 0.3)] : this.floor);
          this.cal = [];
          this.calibrated = true;
          this.st = "waiting";
        }
        return null;
      }
      case "waiting": {
        this.keepPre({ t: now, samples });
        if (now < this.holdUntil) return null;
        if (rms >= this.startLevel) {
          if (!this.loudSince) this.loudSince = now;
          if (now - this.loudSince >= this.opts.attackMs) {
            // Speech: the turn starts with the pre-roll (and the attack) already in it.
            this.st = "speech";
            this.turn = this.pre;
            this.pre = [];
            this.turnFrom = this.turn[0]?.t ?? now;
            this.firstLoud = this.loudSince;
            this.lastLoud = now;
            this.heard = true;
            this.loudSince = 0;
            this.quietSince = 0;
            return "start";
          }
        } else {
          if (rms < this.endLevel) this.loudSince = 0;
          // The room changes (a fan, a window): follow it slowly while she isn't talking.
          if (!this.loudSince) this.floor = clampFloor(this.floor + (raw - this.floor) * Math.min(1, dt / 2000));
        }
        return null;
      }
      case "speech": {
        this.turn.push({ t: now, samples });
        if (rms >= (this.heard ? this.endLevel : this.startLevel)) {
          if (!this.heard) this.firstLoud = now;
          this.heard = true;
          this.lastLoud = now;
          this.quietSince = 0;
        } else if (this.heard) {
          if (!this.quietSince) this.quietSince = now;
          if (now - this.quietSince >= this.opts.silenceMs) return this.finish("end");
        }
        if (!this.heard && now - this.turnFrom >= this.opts.forcedWaitMs) return this.finish("drop");
        if (now - this.turnFrom >= this.opts.maxTurnMs) return this.finish("max");
        return null;
      }
    }
  }

  /** The turn so far (pre-roll included), and back to waiting. Use after "end"/"max", or a tap to send. */
  take(): Float32Array[] {
    const out = this.turn.map((c) => c.samples).filter((s): s is Float32Array => !!s);
    this.turn = [];
    if (this.st === "speech") { this.st = this.calibrated ? "waiting" : "gated"; this.reset(); }
    return out;
  }

  private finish(ev: "end" | "max" | "drop"): VadEvent {
    const spoke = this.lastLoud - this.firstLoud;
    // Before the room has been learnt (a turn started by a tap), it waits for the gate to open again.
    this.st = this.calibrated ? "waiting" : "gated";
    this.loudSince = 0;
    this.quietSince = 0;
    if (ev === "drop" || (ev === "end" && !this.forced && spoke < this.opts.minSpeechMs)) {
      this.turn = [];
      this.forced = false;
      return "drop";
    }
    this.forced = false;
    // The turn stays in `turn` until take().
    return ev;
  }

  private keepPre(c: Chunk) {
    this.pre.push(c);
    const from = c.t - this.opts.preRollMs - this.opts.attackMs;
    while (this.pre.length && this.pre[0].t < from) this.pre.shift();
  }

  private reset() {
    this.pre = [];
    this.turn = [];
    this.loudSince = 0;
    this.quietSince = 0;
    this.firstLoud = 0;
    this.lastLoud = 0;
    this.forced = false;
    this.heard = false;
    this.env = 0;
  }
}

const clampFloor = (v: number) => Math.min(0.05, Math.max(0.001, v));
