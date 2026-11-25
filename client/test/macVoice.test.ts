// Pip's voice made on the Mac: what gets spoken, in what pieces, and what's said while it's coming.

import { describe, expect, it } from "vitest";
import { DEFAULT_MAC_VOICE, MAC_VOICES, macVoiceOffered, savedMacVoice, speakable, speakOnMac, speechChunks, voiceProgressText, type VoiceStatus } from "../src/lib/macVoice";

const st = (phase: VoiceStatus["phase"], progress = 0): VoiceStatus => ({ phase, progress, rtf: null, voices: MAC_VOICES.map((v) => ({ ...v })) });

describe("the Mac voice", () => {
  it("offers six British voices, Emma first", () => {
    expect(MAC_VOICES.map((v) => v.id)).toEqual(["bf_emma", "bf_isabella", "bf_lily", "bf_alice", "bm_fable", "bm_george"]);
    expect(DEFAULT_MAC_VOICE).toBe("bf_emma");
    expect(savedMacVoice()).toBe("bf_emma"); // no storage here: the default
  });

  it("speaks like the home voice: no emoji or markdown", () => {
    expect(speakable("**Well done!** 🎉 See [this](https://x.example) ")).toBe("Well done! See this");
  });

  it("splits a reply into sentences, first one short and quick", () => {
    expect(speechChunks("Oh! That’s brilliant, honestly, really great work. Shall we try the next one? It’s 3.5 times harder…")).toEqual([
      "Oh!", "That’s brilliant, honestly, really great work.", "Shall we try the next one? It’s 3.5 times harder…",
    ]);
    // Short sentences after the first are joined to the next, so there are fewer little pauses.
    expect(speechChunks("Hi! Yes. I love that idea so much, let’s do it.")).toEqual(["Hi!", "Yes. I love that idea so much, let’s do it."]);
    expect(speechChunks("   ")).toEqual([]);
  });

  it("splits a very long sentence at a pause", () => {
    const long = `${"word ".repeat(30)}and then, ${"more ".repeat(40)}end.`;
    const parts = speechChunks(long, 220);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(220);
    expect(parts.join(" ").replace(/\s+/g, " ")).toBe(long.trim().replace(/\s+/g, " "));
  });

  it("says how it's coming along", () => {
    expect(voiceProgressText(st("downloading", 0.4), "Pip")).toBe("Getting Pip’s new voice ready… 40%");
    expect(voiceProgressText(st("ready"), "Pip")).toBe("");
    expect(macVoiceOffered(st("absent"))).toBe(true);
    expect(macVoiceOffered(st("slow"))).toBe(false);
    expect(macVoiceOffered({ ...st("unsupported"), voices: [] })).toBe(false);
  });

  it("leaves it to the home voice outside the Mac app", async () => {
    expect(await speakOnMac("Hello there.", () => undefined)).toBe("home");
  });
});
