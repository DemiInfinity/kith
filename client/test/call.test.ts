import { describe, expect, it } from "vitest";
import { callMood, callStatus, callView, nearestCorner } from "../src/lib/call";
import { DEFAULT_LOOK } from "../src/pip3d/look";
import { playHangUp } from "../src/lib/sounds";

describe("the call screen", () => {
  it("falls back to the 2D avatar without a saved 3D look", () => {
    expect(callView({ picture: null, look: undefined, webgl: undefined, failed: false })).toBe("2d");
    expect(callView({ picture: 5, look: null, webgl: true, failed: false })).toBe("2d");
  });
  it("falls back to 2D when WebGL won't start", () => {
    expect(callView({ picture: 5, look: DEFAULT_LOOK, webgl: false, failed: false })).toBe("2d");
    expect(callView({ picture: 5, look: DEFAULT_LOOK, webgl: true, failed: true })).toBe("2d");
  });
  it("shows the full 3D Pip once the look and WebGL are ready", () => {
    expect(callView({ picture: 5, look: undefined, webgl: true, failed: false })).toBe("wait");
    expect(callView({ picture: 5, look: DEFAULT_LOOK, webgl: undefined, failed: false })).toBe("wait");
    expect(callView({ picture: 5, look: DEFAULT_LOOK, webgl: true, failed: false })).toBe("3d");
  });
  it("Pip listens while she talks, thinks while it waits, and shows its mood when it talks", () => {
    expect(callMood("listening", "happy")).toBe("listening");
    expect(callMood("hearing", "happy")).toBe("thinking");
    expect(callMood("thinking", "happy")).toBe("thinking");
    expect(callMood("speaking", "happy")).toBe("happy");
    expect(callMood("speaking", "concerned")).toBe("listening");
    expect(callMood("idle", "resting")).toBe("sleepy");
  });

  it("says clearly whether it's listening", () => {
    const base = { phase: "idle" as const, mode: "handsfree" as const, muted: false, ear: "open" as const, name: "Pip" };
    expect(callStatus(base)).toBe("Go ahead, I’m listening");
    expect(callStatus({ ...base, ear: "ready" })).toBe("Getting ready to listen…");
    expect(callStatus({ ...base, ear: "start" })).toBe("Tap the mic to start");
    expect(callStatus({ ...base, phase: "listening" })).toBe("Listening…");
    expect(callStatus({ ...base, muted: true })).toBe("You’re muted");
    expect(callStatus({ ...base, phase: "speaking" })).toMatch(/^Pip is talking/);
    expect(callStatus({ ...base, mode: "tap", ear: "off" })).toBe("Tap the mic to talk");
    expect(callStatus({ ...base, phase: "ended" })).toBe("Pip hung up");
  });
  it("the mini call snaps to the nearest corner", () => {
    expect(nearestCorner(100, 100, 1000, 800)).toBe("tl");
    expect(nearestCorner(900, 100, 1000, 800)).toBe("tr");
    expect(nearestCorner(100, 700, 1000, 800)).toBe("bl");
    expect(nearestCorner(900, 700, 1000, 800)).toBe("br");
  });

  it("the hang-up sound only plays on a call whose audio was running", () => {
    expect(playHangUp(null)).toBe(0);
    expect(playHangUp({ state: "suspended" } as unknown as AudioContext)).toBe(0);
    const made: number[] = [];
    const param = { setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined };
    const node = () => ({ connect: (n: unknown) => n, start: () => undefined, stop: () => undefined, type: "", frequency: param, gain: param });
    const ctx = { state: "running", currentTime: 0, destination: {}, createOscillator: () => { made.push(1); return node(); }, createGain: node };
    const ms = playHangUp(ctx as unknown as AudioContext);
    expect(ms).toBeGreaterThanOrEqual(400);
    expect(ms).toBeLessThanOrEqual(600);
    expect(made).toHaveLength(2); // two gentle notes
  });
});
