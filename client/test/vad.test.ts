import { describe, expect, it } from "vitest";
import { HANDS_FREE, MAX_TURN_MS, TAP_TO_TALK, Vad, type VadEvent } from "../src/lib/vad";

// 10 ms frames. Each frame carries one sample holding its time, so the tests can see exactly which
// audio a turn kept.
const STEP = 10;
type Run = { t: number; events: { t: number; ev: VadEvent }[] };
function feed(v: Vad, run: Run, rms: number, ms: number) {
  for (let i = 0; i < ms; i += STEP) {
    const ev = v.frame(rms, run.t, Float32Array.of(run.t));
    if (ev) run.events.push({ t: run.t, ev });
    run.t += STEP;
  }
}
const QUIET = 0.004;
const VOICE = 0.08;

/** Hands-free, gate open, past the first second's calibration. */
function ready(opts = {}) {
  const v = new Vad({ ...HANDS_FREE, ...opts });
  const run: Run = { t: 1000, events: [] };
  v.setGate(false, run.t);
  expect(v.state).toBe("calibrating");
  feed(v, run, QUIET, 1010);
  expect(v.state).toBe("waiting");
  feed(v, run, QUIET, 300); // past the settle time
  run.events = [];
  return { v, run };
}

describe("noticing when she talks (hands-free)", () => {
  it("learns the room's noise in the first second, and nothing starts meanwhile", () => {
    const v = new Vad();
    const run: Run = { t: 0, events: [] };
    v.setGate(false, 0);
    feed(v, run, 0.01, 900);
    expect(v.state).toBe("calibrating");
    feed(v, run, 0.01, 200);
    expect(v.state).toBe("waiting");
    expect(v.noiseFloor).toBeCloseTo(0.01, 3);
    expect(run.events).toEqual([]);
    // A noisier room needs a louder voice to start.
    expect(v.startLevel).toBeCloseTo(0.03, 3);
  });

  it("doesn't learn that the room is loud if she talks straight away", () => {
    const v = new Vad();
    const run: Run = { t: 0, events: [] };
    v.setGate(false, 0);
    feed(v, run, QUIET, 700);
    feed(v, run, VOICE, 310);
    expect(v.state).toBe("waiting");
    expect(v.noiseFloor).toBeLessThan(0.01);
  });

  it("starts on speech above the threshold, not on quiet sounds or a click", () => {
    const { v, run } = ready();
    feed(v, run, 0.012, 1000); // below the start level (3× the floor, at least 0.02)
    feed(v, run, VOICE, 30); // a click: shorter than the attack
    feed(v, run, QUIET, 400);
    expect(run.events).toEqual([]);
    feed(v, run, VOICE, 200);
    expect(run.events.map((e) => e.ev)).toEqual(["start"]);
    expect(v.inTurn).toBe(true);
  });

  it("keeps ~300 ms from before the speech (pre-roll), so the first word isn't clipped", () => {
    const { v, run } = ready();
    const speechAt = run.t;
    feed(v, run, VOICE, 1000);
    feed(v, run, QUIET, 1500);
    const ends = run.events.filter((e) => e.ev === "end");
    expect(ends).toHaveLength(1);
    const kept = v.take().map((s) => s[0]);
    // The turn begins about 300 ms before the speech did…
    expect(kept[0]).toBeLessThanOrEqual(speechAt - 280);
    expect(kept[0]).toBeGreaterThanOrEqual(speechAt - 300 - 10);
    // …and runs through to the end of the quiet that finished it.
    expect(kept[kept.length - 1]).toBe(ends[0].t);
  });

  it("ends the turn after ~900 ms of quiet, not after a short pause", () => {
    const { v, run } = ready();
    feed(v, run, VOICE, 500);
    feed(v, run, QUIET, 600); // a pause between words
    feed(v, run, VOICE, 500);
    expect(run.events.map((e) => e.ev)).toEqual(["start"]);
    const quietFrom = run.t;
    feed(v, run, QUIET, 1500);
    const end = run.events.find((e) => e.ev === "end");
    expect(end).toBeTruthy();
    // 900 ms after the voice stopped (plus the level's short fall-away).
    expect(end!.t - quietFrom).toBeGreaterThanOrEqual(900);
    expect(end!.t - quietFrom).toBeLessThan(1150);
    expect(v.state).toBe("waiting");
  });

  it("drops a turn that's too short to be speech", () => {
    const { v, run } = ready();
    feed(v, run, VOICE, 140); // just past the attack: a bump
    feed(v, run, QUIET, 1200);
    expect(run.events.map((e) => e.ev)).toEqual(["start", "drop"]);
    expect(v.take()).toEqual([]);
    expect(v.state).toBe("waiting");
  });

  it("caps a turn at the longest the server takes", () => {
    const { v, run } = ready({ maxTurnMs: 3000 });
    feed(v, run, VOICE, 3500);
    expect(run.events.map((e) => e.ev).slice(0, 2)).toEqual(["start", "max"]);
    expect(run.events[1].t - run.events[0].t).toBeLessThanOrEqual(3000);
    expect(HANDS_FREE.maxTurnMs).toBe(MAX_TURN_MS);
    expect(MAX_TURN_MS).toBeLessThan(120_000); // the server's two minutes
  });

  it("never listens while the gate is shut (Pip talking, muted, busy), and throws away what it had", () => {
    const { v, run } = ready();
    feed(v, run, VOICE, 300);
    expect(v.inTurn).toBe(true);
    v.setGate(true, run.t); // e.g. muted mid-turn
    expect(v.state).toBe("gated");
    feed(v, run, VOICE, 3000); // Pip's own voice through the speakers
    feed(v, run, QUIET, 2000);
    expect(run.events.map((e) => e.ev)).toEqual(["start"]);
    expect(v.take()).toEqual([]);
  });

  it("listens again when the gate opens, after a moment to settle (no new calibration)", () => {
    const { v, run } = ready();
    v.setGate(true, run.t);
    feed(v, run, VOICE, 1000);
    v.setGate(false, run.t);
    expect(v.state).toBe("waiting");
    // The tail of Pip's voice right after it stops doesn't start a turn.
    feed(v, run, VOICE, 200);
    feed(v, run, QUIET, 200);
    expect(run.events).toEqual([]);
    feed(v, run, VOICE, 300);
    expect(run.events.map((e) => e.ev)).toEqual(["start"]);
  });

  it("opening an already-open gate changes nothing", () => {
    const { v, run } = ready();
    feed(v, run, VOICE, 300);
    v.setGate(false, run.t);
    expect(v.inTurn).toBe(true);
  });
});

describe("tap to talk", () => {
  it("starts on the tap and ends after speech and ~1.2 s of quiet", () => {
    const v = new Vad(TAP_TO_TALK);
    const run: Run = { t: 0, events: [] };
    v.forceStart(0);
    expect(v.inTurn).toBe(true);
    feed(v, run, QUIET, 3000); // she hasn't started yet: it waits
    expect(run.events).toEqual([]);
    feed(v, run, VOICE, 600);
    const quietFrom = run.t;
    feed(v, run, QUIET, 2000);
    const end = run.events.find((e) => e.ev === "end")!;
    expect(end.t - quietFrom).toBeGreaterThanOrEqual(1200);
    expect(v.take().length).toBeGreaterThan(0);
  });

  it("is capped too", () => {
    const v = new Vad({ ...TAP_TO_TALK, maxTurnMs: 2000 });
    const run: Run = { t: 0, events: [] };
    v.forceStart(0);
    feed(v, run, QUIET, 2500);
    expect(run.events.map((e) => e.ev)).toEqual(["max"]);
  });

  it("a tap in hands-free that hears nothing gives up after a while (tap to talk waits)", () => {
    const v = new Vad({ ...HANDS_FREE, forcedWaitMs: 5000 });
    const run: Run = { t: 0, events: [] };
    v.forceStart(0);
    feed(v, run, QUIET, 6000);
    expect(run.events.map((e) => e.ev)).toEqual(["drop"]);
    expect(v.take()).toEqual([]);
    // Not calibrated yet: it waits for the gate to open again, then learns the room.
    expect(v.state).toBe("gated");
    v.setGate(false, run.t);
    expect(v.state).toBe("calibrating");
    expect(TAP_TO_TALK.forcedWaitMs).toBe(Infinity);
  });
});
