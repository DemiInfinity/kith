import { describe, expect, it } from "vitest";
import { computeDeskEnergy, computeEnergy, type SpendRow } from "../src/budget/budget.js";
import { costUsd } from "../src/budget/pricing.js";
import { inQuietHours, nextWeekStart, startOfWeek, zonedTime } from "../src/budget/time.js";
import { Budgets } from "../src/settings.js";

const TZ = "Europe/London";
const B = Budgets.parse({});
const HOUR = 3_600_000;
// Wednesday 25 November 2026, 16:00 London (GMT, so UTC too).
const WED = zonedTime(2026, 11, 25, 16, 0, TZ);
const chat = (ts: number, usd: number): SpendRow => ({ ts, usd, bucket: "chat" });
const desk = (ts: number, usd: number): SpendRow => ({ ts, usd, bucket: "desk" });

describe("pricing", () => {
  it("prices Sonnet 5.5 and Haiku 5.5 per million tokens", () => {
    expect(costUsd("claude-sonnet-5-5", { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBeCloseTo(12);
    expect(costUsd("claude-haiku-5-5", { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBeCloseTo(0.6);
  });
  it("counts cache reads and writes", () => {
    expect(costUsd("claude-sonnet-5-5", { cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000 })).toBeCloseTo(2.6);
  });
  it("over-counts an unknown model rather than under-counting", () => {
    expect(costUsd("mystery", { input_tokens: 1_000_000 })).toBeGreaterThanOrEqual(4);
  });
});

describe("time", () => {
  it("weeks start at local midnight on Monday", () => {
    expect(new Date(startOfWeek(WED, TZ, 1)).toISOString()).toBe("2026-11-23T00:00:00.000Z");
    expect(new Date(nextWeekStart(WED, TZ, 1)).toISOString()).toBe("2026-11-30T00:00:00.000Z");
  });
  it("handles British Summer Time", () => {
    const summer = zonedTime(2026, 7, 15, 12, 0, TZ); // Wednesday, BST
    expect(new Date(startOfWeek(summer, TZ, 1)).toISOString()).toBe("2026-07-12T23:00:00.000Z");
  });
  it("quiet hours can cross midnight", () => {
    const q = { start: "22:00", end: "07:00" };
    expect(inQuietHours(zonedTime(2026, 11, 25, 23, 30, TZ), TZ, q)).toBe(true);
    expect(inQuietHours(zonedTime(2026, 11, 25, 6, 59, TZ), TZ, q)).toBe(true);
    expect(inQuietHours(zonedTime(2026, 11, 25, 7, 0, TZ), TZ, q)).toBe(false);
    expect(inQuietHours(zonedTime(2026, 11, 25, 16, 0, TZ), TZ, q)).toBe(false);
  });
});

describe("energy", () => {
  it("starts the week on Full power at 100%", () => {
    const e = computeEnergy([], WED, B, TZ);
    expect(e.mode).toBe("full");
    expect(e.percent).toBe(100);
  });

  it("shows weekly energy as a percentage of $11.50", () => {
    const e = computeEnergy([chat(WED - 48 * HOUR, 2.3)], WED, B, TZ);
    expect(e.percent).toBe(80);
    expect(e.mode).toBe("full");
    expect(e.usd.week).toBeCloseTo(2.3);
  });

  it("ignores last week's spending", () => {
    const e = computeEnergy([chat(WED - 4 * 24 * HOUR, 11)], WED, B, TZ);
    expect(e.percent).toBe(100);
  });

  it("the 5-hour window limits a long evening", () => {
    const e = computeEnergy([chat(WED - HOUR, 2.7)], WED, B, TZ);
    expect(e.percent).toBe(10);
    expect(e.limitedBy).toBe("window");
    expect(e.mode).toBe("low");
  });

  it("says when Full power comes back as window spending ages out", () => {
    const rows = [chat(WED - 4 * HOUR, 1.5), chat(WED - 1 * HOUR, 1.2)];
    const e = computeEnergy(rows, WED, B, TZ);
    expect(e.mode).toBe("low");
    // Once the first $1.50 drops out (in an hour), the window is back above the threshold.
    expect(e.fullBackAt).toBe(WED - 4 * HOUR + 5 * HOUR);
  });

  it("switches to Low power when the week is nearly spent, back on Monday", () => {
    const e = computeEnergy([chat(WED - 30 * HOUR, 10.6)], WED, B, TZ);
    expect(e.mode).toBe("low");
    expect(e.limitedBy).toBe("week");
    expect(e.fullBackAt).toBe(nextWeekStart(WED, TZ, 1));
  });

  it("rests once the week and Low power's reserve are used", () => {
    const e = computeEnergy([chat(WED - 30 * HOUR, 11.5 + 1.5)], WED, B, TZ);
    expect(e.mode).toBe("resting");
    expect(e.percent).toBe(0);
  });

  it("rests at the monthly backstop", () => {
    const rows = [chat(WED - 9 * 24 * HOUR, 30), desk(WED - 2 * 24 * HOUR, 20)];
    expect(computeEnergy(rows, WED, B, TZ).mode).toBe("resting");
  });

  it("desk spending never takes chat energy", () => {
    const e = computeEnergy([desk(WED - HOUR, 5)], WED, B, TZ);
    expect(e.percent).toBe(100);
  });

  it("honours custom budgets", () => {
    const b = Budgets.parse({ weeklyUsd: 20, windowUsd: 5 });
    expect(computeEnergy([chat(WED - 2 * HOUR, 4)], WED, b, TZ).percent).toBe(20);
  });
});

describe("desk energy", () => {
  it("uses its own $10 monthly budget", () => {
    const d = computeDeskEnergy([desk(WED - HOUR, 2.5), chat(WED - HOUR, 2)], WED, B, TZ);
    expect(d.percent).toBe(75);
    expect(d.canWork).toBe(true);
    expect(d.mode).toBe("full");
  });
  it("drops to Low power near the end and stops when spent", () => {
    expect(computeDeskEnergy([desk(WED - HOUR, 9)], WED, B, TZ).mode).toBe("low");
    expect(computeDeskEnergy([desk(WED - HOUR, 10)], WED, B, TZ).canWork).toBe(false);
  });
  it("tops up on the 1st", () => {
    const d = computeDeskEnergy([desk(zonedTime(2026, 10, 30, 12, 0, TZ), 10)], WED, B, TZ);
    expect(d.percent).toBe(100);
  });
});
