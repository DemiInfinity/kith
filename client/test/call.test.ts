import { describe, expect, it } from "vitest";
import { callMood, callView } from "../src/lib/call";
import { DEFAULT_LOOK } from "../src/pip3d/look";

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
});
