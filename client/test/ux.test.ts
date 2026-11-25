import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, isAbort, OFFLINE_WORDS, timeoutFor } from "../src/api";
import { pollWhileVisible } from "../src/lib/poll";
import { action, failureWords } from "../src/lib/action";
import { budgetProblem, changedSettings, helplineProblem } from "../src/screens/Parent";
import { helplineWords } from "../src/screens/Meet";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("api() when home can't be reached", () => {
  it("a network failure becomes a friendly ApiError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Load failed"); }));
    const e = await api("/api/state").catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e.message).toBe(OFFLINE_WORDS);
    expect(e.code).toBe("offline");
  });
  it("a gateway error with no message from Kith is the same friendly words", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad gateway", { status: 502 })));
    const e = await api("/api/state").catch((x) => x);
    expect(e.message).toBe(OFFLINE_WORDS);
  });
  it("Kith's own error message is kept", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "That’s too long." }, { status: 400 })));
    const e = await api("/api/memories", { body: {} }).catch((x) => x);
    expect(e.message).toBe("That’s too long.");
    expect(e.status).toBe(400);
  });
  it("times out instead of waiting for ever", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_u: string, init: RequestInit) => new Promise((_r, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })));
    const p = api("/api/state").catch((x) => x);
    await vi.advanceTimersByTimeAsync(15_001);
    const e = await p;
    expect(e).toBeInstanceOf(ApiError);
    expect(e.code).toBe("timeout");
  });
  it("a deliberate abort stays an AbortError, so End call isn't shown as a failure", async () => {
    vi.stubGlobal("fetch", vi.fn((_u: string, init: RequestInit) => new Promise((_r, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })));
    const ctrl = new AbortController();
    const p = api("/api/chat", { body: { text: "hi" }, signal: ctrl.signal }).catch((x) => x);
    ctrl.abort();
    expect(isAbort(await p)).toBe(true);
  });
  it("chat, voice and other Claude calls get about a minute; the rest 15 seconds", () => {
    expect(timeoutFor("/api/chat", "POST")).toBe(60_000);
    expect(timeoutFor("/api/voice/stt", "POST")).toBe(60_000);
    expect(timeoutFor("/api/study/cards/generate", "POST")).toBe(60_000);
    expect(timeoutFor("/api/languages/es/cards/generate", "POST")).toBe(60_000);
    expect(timeoutFor("/api/state", "GET")).toBe(15_000);
    expect(timeoutFor("/api/memories", "POST")).toBe(15_000);
  });
});

describe("polling rests while the page is hidden", () => {
  it("doesn't poll while hidden, and refreshes when shown again", () => {
    vi.useFakeTimers();
    const listeners: Record<string, () => void> = {};
    const doc = { hidden: false, addEventListener: (k: string, f: () => void) => { listeners[k] = f; }, removeEventListener: vi.fn() };
    vi.stubGlobal("document", doc);
    const fn = vi.fn();
    const stop = pollWhileVisible(fn, 1000);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3000);
    expect(fn).toHaveBeenCalledTimes(4);
    doc.hidden = true; listeners.visibilitychange();
    vi.advanceTimersByTime(10_000);
    expect(fn).toHaveBeenCalledTimes(4);
    doc.hidden = false; listeners.visibilitychange();
    expect(fn).toHaveBeenCalledTimes(5);
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(6);
    stop();
    vi.advanceTimersByTime(5000);
    expect(fn).toHaveBeenCalledTimes(6);
  });
});

describe("grown-up view guards", () => {
  it("an empty budget box is invalid, not 0", () => {
    expect(budgetProblem("weeklyUsd", "")).toMatch(/empty/);
    expect(budgetProblem("weeklyUsd", "0")).toBe("");
    expect(budgetProblem("weeklyUsd", "12.5")).toBe("");
  });
  it("a hard stop of 0 can't be saved", () => {
    expect(budgetProblem("hardStopUsd", "0")).toMatch(/\$0/);
    expect(budgetProblem("hardStopUsd", "48")).toBe("");
  });
  it("limits are checked", () => {
    expect(budgetProblem("windowHours", "0")).toMatch(/Between 1 and 24/);
    expect(budgetProblem("lowPowerAtPercent", "101")).toMatch(/Between/);
  });
  const h = (name: string, number: string) => ({ name, number, sub: "", kind: "helpline" as const });
  it("999 and at least one number always stay", () => {
    expect(helplineProblem([])).toMatch(/at least one/);
    expect(helplineProblem([h("Childline", "0800 1111")])).toMatch(/999/);
    expect(helplineProblem([h("Emergency", "999"), h("", "123")])).toMatch(/name and a number/);
    expect(helplineProblem([h("Emergency", "9 9 9"), h("Childline", "0800 1111")])).toBe("");
  });
  it("only the settings changed on a tab are saved", () => {
    const before = { budgets: { a: 1 }, helplines: [1], connections: [{ id: "x" }] };
    expect(changedSettings(before, { ...before, budgets: { a: 2 } })).toEqual({ budgets: { a: 2 } });
    expect(changedSettings(before, { ...before })).toEqual({});
  });
});

describe("wizard", () => {
  it("builds its helpline words from the Grown-up? numbers", () => {
    expect(helplineWords(["Childline", "999"])).toBe("Childline or 999");
    expect(helplineWords(["Childline", "Shout", "999"])).toBe("Childline, Shout or 999");
    expect(helplineWords([])).toBe("999");
  });
});

describe("failed actions", () => {
  it("a failure becomes a toast, an abort doesn't", async () => {
    const shown: string[] = [];
    const target = new EventTarget();
    vi.stubGlobal("window", { dispatchEvent: (e: CustomEvent<string>) => { shown.push(e.detail); return target.dispatchEvent(e); } });
    action(async () => { throw new ApiError(OFFLINE_WORDS, 0, "offline"); }, "pin it")();
    action(async () => { throw new DOMException("x", "AbortError"); })();
    await new Promise((r) => setTimeout(r, 0));
    expect(shown).toEqual([`Couldn’t pin it. ${OFFLINE_WORDS}`]);
    expect(failureWords(new Error(""))).toMatch(/Try again/);
  });
});
