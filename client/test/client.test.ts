import { describe, expect, it } from "vitest";
import { toPcm16 } from "../src/lib/audio";
import { energyWords } from "../src/components/bits";
import { sampleLine } from "../src/screens/Personality";
import type { Energy, Profile } from "../src/api";

const monday = new Date(2026, 10, 30).getTime();
const e = (over: Partial<Energy>): Energy => ({ mode: "full", percent: 72, fullBackAt: null, weekResetsAt: monday, limitedBy: null, ...over });

describe("energy words (the child sees energy, never money)", () => {
  it("Full power", () => {
    const w = energyWords(e({}));
    expect(w).toMatchObject({ icon: "fire", title: "Full power", pct: "72% left" });
    expect(w.sub).toBe("this week’s energy · tops up Monday");
  });
  it("Low power keeps Grown-up? in view", () => {
    const w = energyWords(e({ mode: "low", percent: 8 }));
    expect(w.title).toBe("Low power");
    expect(w.pct).toBe("8% left · resets Monday");
    expect(w.sub).toMatch(/Grown-up\?/);
  });
  it("Resting", () => {
    expect(energyWords(e({ mode: "resting", percent: 0 })).title).toBe("Resting");
  });
  it("never shows a pound or dollar sign", () => {
    for (const mode of ["full", "low", "resting"] as const) {
      expect(JSON.stringify(energyWords(e({ mode })))).not.toMatch(/[$£]/);
    }
  });
});

describe("voice audio", () => {
  it("downsamples to 16 kHz 16-bit PCM", () => {
    const input = new Float32Array(48000).fill(0.5);
    const pcm = new Int16Array(toPcm16(input, 48000, 16000));
    expect(pcm.length).toBe(16000);
    expect(pcm[100]).toBeGreaterThan(16000);
  });
  it("clips loud samples", () => {
    const pcm = new Int16Array(toPcm16(new Float32Array([2, -2, 2, -2]), 16000, 16000));
    expect([...pcm]).toEqual([32767, -32768, 32767, -32768]);
  });
});

describe("personality preview", () => {
  const p = (traits: string[]) => ({ traits } as unknown as Profile);
  it("changes with the traits picked", () => {
    expect(sampleLine(p(["Funny"]))).toMatch(/lowest common denominator/);
    expect(sampleLine(p(["Calm"]))).toMatch(/No rush/);
    expect(sampleLine(p([]))).toMatch(/cheer you on/);
  });
});
