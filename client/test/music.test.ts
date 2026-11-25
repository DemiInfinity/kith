// Pip listens along (the Mac app): the status line, the headphones that are only ever shown, and
// the song-name setting that starts off.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { doingText } from "../src/components/bits";
import { musicForTurn, musicWords, setSongsAllowed, songsAllowed, tidy } from "../src/lib/music";
import { DEFAULT_LOOK, musicWear, normaliseLook } from "../src/pip3d/look";
import { miniState } from "../src/lib/callMac";
import type { Energy } from "../src/api";

const energy = (mode: Energy["mode"]) => ({ mode, percent: 50, weekResetsAt: Date.now() + 86_400_000 }) as Energy;
const state = (o: { mode?: Energy["mode"]; working?: boolean; browsing?: boolean } = {}) => ({
  energy: energy(o.mode ?? "full"),
  desk: { working: o.working ? { kind: "web", title: "a quiz" } : null, browsing: o.browsing ? { title: "Owls", by: null } : null },
});

// A small localStorage for node.
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k),
  };
});
afterEach(() => { delete (globalThis as { localStorage?: unknown }).localStorage; });

describe("Pip's status while music plays", () => {
  const playing = { playing: true };
  it("says it's listening along, above free to chat", () => {
    expect(doingText(state(), "happy")).toBe("free to chat");
    expect(doingText(state(), "happy", playing)).toBe("listening to music with you");
    expect(doingText(state(), "happy", { playing: false })).toBe("free to chat");
    expect(doingText(state({ mode: "low" }), "sleepy", playing)).toBe("listening to music with you");
  });
  it("names the song only when it was allowed through", () => {
    expect(doingText(state(), "happy", { playing: true, title: "Moonlit Bikes" })).toBe("listening to “Moonlit Bikes” with you");
    expect(musicWords(tidy({ playing: true, title: "Moonlit Bikes" }, false))).toBe("listening to music with you");
  });
  it("comes below busier things", () => {
    expect(doingText(state({ mode: "resting" }), "happy", playing)).toBe("resting until the energy tops up");
    expect(doingText(state({ working: true }), "happy", playing)).toBe("making a quiz");
    expect(doingText(state({ browsing: true }), "happy", playing)).toBe("reading “Owls”");
    expect(doingText(state(), "thinking", playing)).toBe("thinking…");
  });
});

describe("the headphones are only ever shown", () => {
  it("adds headphones on top without changing the look", () => {
    const look = normaliseLook({ ...DEFAULT_LOOK, wear: ["scarf"] });
    const before = JSON.stringify(look);
    const shown = musicWear(look.wear, true);
    expect([...shown].sort()).toEqual(["headphones", "scarf"]);
    expect(JSON.stringify(look)).toBe(before); // the look (what's saved) is untouched
    expect([...musicWear(look.wear, false)]).toEqual(["scarf"]);
    expect([...musicWear(["headphones"], true)]).toEqual(["headphones"]); // no double pair
  });
  it("reaches the Mac app's mini window as a flag, not as part of the look", () => {
    const s = { phase: "idle" as const, mood: "happy" as const, muted: false, mode: "tap" as const, ear: "off" as const };
    expect(miniState(s, "Pip", 3, true).music).toBe(true);
    expect(miniState(s, "Pip", 3).music).toBe(false);
  });
});

describe("Let Pip know what song is playing", () => {
  it("is off to start with", () => {
    expect(songsAllowed()).toBe(false);
    expect(tidy({ playing: true, title: "Song", artist: "Band" }, songsAllowed())).toEqual({ playing: true });
  });
  it("lets the song through only once she switches it on", () => {
    setSongsAllowed(true);
    expect(songsAllowed()).toBe(true);
    expect(tidy({ playing: true, title: " Song ", artist: "Band" }, songsAllowed())).toEqual({ playing: true, title: "Song", artist: "Band" });
    setSongsAllowed(false);
    expect(songsAllowed()).toBe(false);
  });
  it("tells a chat turn nothing when no music is playing (and in a browser)", () => {
    expect(musicForTurn()).toBeUndefined();
    expect(tidy(null, true)).toEqual({ playing: false });
  });
});
