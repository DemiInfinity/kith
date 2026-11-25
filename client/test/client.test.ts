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

describe("signing in from an installed app", () => {
  const ID = "i".repeat(43), SECRET = "s".repeat(43);
  type Call = { url: string; init?: RequestInit };
  const json = (status: number, j: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => j }) as Response;
  it("starts a handoff on the server and keeps its secret in memory", async () => {
    const { startHandoff } = await import("../src/lib/signin");
    const calls: Call[] = [];
    const f = (async (url: string, init?: RequestInit) => { calls.push({ url, init }); return json(200, { id: ID, secret: SECRET, code: "4821", expiresIn: 900 }); }) as unknown as typeof fetch;
    const h = await startHandoff("child", f, 1000, "homescreen");
    expect(h).toEqual({ id: ID, secret: SECRET, code: "4821", at: 1000, expiresAt: 1000 + 900_000 });
    expect(calls[0].url).toBe("/auth/handoff/start");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ app: "child", device: "homescreen" });
    // An older server has no code (and no confirm step).
    const old = (async () => json(200, { id: ID, secret: SECRET })) as unknown as typeof fetch;
    expect((await startHandoff(null, old))?.code).toBe("");
    const bad = (async () => json(200, { id: "short", secret: SECRET })) as unknown as typeof fetch;
    expect(await startHandoff(null, bad)).toBeNull();
    const limited = (async () => json(429, { error: "slow down" })) as unknown as typeof fetch;
    expect(await startHandoff(null, limited)).toBeNull();
  });
  it("polls with the secret in a header until the session is handed over", async () => {
    const { vi } = await import("vitest");
    vi.useFakeTimers();
    (globalThis as { document?: unknown }).document = { visibilityState: "visible" };
    const { waitForHandoff } = await import("../src/lib/signin");
    const replies = [{ pending: true }, { pending: true }, { ok: true, redirect: "/" }];
    const seen: Call[] = [];
    const fake = (async (url: string, init?: RequestInit) => { seen.push({ url, init }); return json(200, replies.shift()); }) as unknown as typeof fetch;
    const p = waitForHandoff({ id: ID, secret: SECRET, expiresAt: Date.now() + 900_000 }, new AbortController().signal, fake);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await p).toEqual({ ok: true, redirect: "/" });
    expect(seen).toHaveLength(3);
    expect(seen[0].url).toBe(`/auth/handoff/${ID}`);
    expect(seen[0].url).not.toContain(SECRET);
    expect((seen[0].init?.headers as Record<string, string>)["X-Kith-Handoff-Secret"]).toBe(SECRET);
    vi.useRealTimers();
  });
  it("stops on a refusal, and on an expired handoff", async () => {
    const { vi } = await import("vitest");
    vi.useFakeTimers();
    const { waitForHandoff } = await import("../src/lib/signin");
    const h = { id: ID, secret: SECRET, expiresAt: Date.now() + 900_000 };
    const refused = (async () => json(403, { error: "not-allowed" })) as unknown as typeof fetch;
    let p = waitForHandoff(h, new AbortController().signal, refused);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await p).toEqual({ ok: false, error: "not-allowed" });
    const gone = (async () => json(410, { error: "expired" })) as unknown as typeof fetch;
    p = waitForHandoff(h, new AbortController().signal, gone);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await p).toEqual({ ok: false, error: "expired" });
    vi.useRealTimers();
  });
  it("says what went wrong in plain words", async () => {
    const { handoffWords } = await import("../src/lib/signin");
    const { wrongAppWords } = await import("../src/lib/appHint");
    expect(handoffWords("expired", wrongAppWords)).toBe("That took a while. Try again?");
    expect(handoffWords("not-allowed", wrongAppWords)).toMatch(/isn’t set up for Kith/);
    expect(handoffWords("use-parent-app", wrongAppWords)).toMatch(/Kith Parent/);
    expect(handoffWords("cancelled", wrongAppWords)).toMatch(/^Sign-in was cancelled/);
    expect(handoffWords("bad handoff secret", wrongAppWords)).toBe("Sign-in didn’t finish. Try again?");
    expect(handoffWords("failed", wrongAppWords)).toBe("Sign-in didn’t finish. Try again?");
  });
  it("has words for every sign-in result, on the sign-in screen and in the sign-in window", async () => {
    const { signinWords, doneWords } = await import("../src/lib/signin");
    const { wrongAppWords } = await import("../src/lib/appHint");
    expect(signinWords("expired", wrongAppWords)).toBe("That took a while. Try again?");
    expect(signinWords("failed", wrongAppWords)).toBe("Sign-in didn’t work. Try again?");
    expect(signinWords("not-allowed", wrongAppWords)).toMatch(/isn’t set up for Kith/);
    expect(signinWords("use-parent-app", wrongAppWords)).toMatch(/Kith Parent/);
    expect(signinWords("use-child-app", wrongAppWords)).toMatch(/Kids use Kith/);
    expect(signinWords("something-new", wrongAppWords)).toBe("Sign-in didn’t finish. Try again?");
    expect(signinWords(null, wrongAppWords)).toBeNull();
    expect(doneWords(null, wrongAppWords).text).toMatch(/close this window/);
    for (const e of ["cancelled", "expired", "failed", "not-allowed", "use-parent-app", "use-child-app", "whatever"]) {
      const w = doneWords(e, wrongAppWords);
      expect(w.title, e).not.toBe("You’re signed in");
      expect(w.text.length, e).toBeGreaterThan(10);
    }
  });
  it("toasts stay longer for longer messages", async () => {
    const { toastMs } = await import("../src/lib/action");
    expect(toastMs("Saved.")).toBe(6_000);
    expect(toastMs("x".repeat(120))).toBeGreaterThan(toastMs("x".repeat(60)));
    expect(toastMs("x".repeat(1000))).toBe(15_000);
  });
  it("gets a started handoff and the provider's address ready before the click", async () => {
    const { prepareSignIn, preparedFresh } = await import("../src/lib/signin");
    const seen: string[] = [];
    const ok = (async (url: string) => {
      seen.push(url);
      return url === "/auth/handoff/start" ? json(200, { id: ID, secret: SECRET, expiresIn: 900 }) : json(200, { url: "https://auth.example.com/authorize?state=s" });
    }) as unknown as typeof fetch;
    const p = await prepareSignIn(ok);
    expect(p?.url).toBe("https://auth.example.com/authorize?state=s");
    expect(p?.secret).toBe(SECRET);
    expect(seen).toEqual(["/auth/handoff/start", `/auth/login?handoff=${ID}&json=1`]);
    expect(preparedFresh(p)).toBe(true);
    expect(preparedFresh(p, p!.at + 11 * 60_000)).toBe(false);
    // An older server has no /auth/handoff/start.
    const old = (async () => json(404, {})) as unknown as typeof fetch;
    expect(await prepareSignIn(old)).toBeNull();
    const odd = (async (url: string) => (url === "/auth/handoff/start" ? json(200, { id: ID, secret: SECRET }) : json(200, { url: "javascript:alert(1)" }))) as unknown as typeof fetch;
    expect(await prepareSignIn(odd)).toBeNull();
  });
});
