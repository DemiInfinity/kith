import { describe, expect, it } from "vitest";
import { computeDeskEnergy, computeEnergy, projectMonth, splits, type SpendRow } from "../src/budget/budget.js";
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
  // Defaults: $11.50 a week, 15% to the desk → $9.775 a week for chat; $2.50 per 5-hour window.
  const MON = zonedTime(2026, 11, 23, 0, 30, TZ); // just after the week starts: no rollover yet

  it("starts the week on Full power at 100%", () => {
    const e = computeEnergy([], WED, B, TZ);
    expect(e.mode).toBe("full");
    expect(e.percent).toBe(100);
  });

  it("splits the week between chat and the desk", () => {
    expect(splits(B).chatWeek).toBeCloseTo(9.775);
    expect(splits(B).deskDaily).toBeCloseTo((11.5 * 0.15) / 7);
  });

  it("shows weekly energy against the chat share", () => {
    const e = computeEnergy([chat(WED - 48 * HOUR, 1.955)], WED, B, TZ);
    expect(e.percent).toBe(80);
    expect(e.usd.week).toBeCloseTo(1.955);
  });

  it("ignores last week's spending", () => {
    expect(computeEnergy([chat(WED - 4 * 24 * HOUR, 11)], WED, B, TZ).percent).toBe(100);
  });

  it("the 5-hour window limits a long evening, then Low power carries on", () => {
    const e = computeEnergy([chat(MON + 10 * 60_000, 2.25)], MON + 20 * 60_000, B, TZ);
    expect(e.percent).toBe(10);
    expect(e.limitedBy).toBe("window");
    expect(e.mode).toBe("low");
  });

  it("rolls unused Full power from quieter windows into later ones (capped)", () => {
    // Wednesday 16:00: ~2.4 days of the week gone, nothing spent, so the window gets the full rollover cap.
    const e = computeEnergy([], WED, B, TZ);
    expect(e.usd.windowAllowance).toBeCloseTo(2.5 + 2.5);
    // At the very start of the week there's nothing to roll over.
    expect(computeEnergy([], MON, B, TZ).usd.windowAllowance).toBeCloseTo(2.5);
  });

  it("says when Full power comes back as window spending ages out", () => {
    const now = MON + 5 * HOUR;
    const rows = [chat(MON + 60 * 60_000, 1.3), chat(MON + 4 * HOUR, 1.2)];
    const e = computeEnergy(rows, now, B, TZ);
    expect(e.mode).toBe("low");
    expect(e.limitedBy).toBe("window");
    expect(e.fullBackAt).toBe(MON + 60 * 60_000 + 5 * HOUR);
  });

  it("switches to Low power when the week is nearly spent, back when it tops up", () => {
    const e = computeEnergy([chat(WED - 30 * HOUR, 9)], WED, B, TZ);
    expect(e.mode).toBe("low");
    expect(e.limitedBy).toBe("week");
    expect(e.fullBackAt).toBe(nextWeekStart(WED, TZ, 1));
  });

  it("keeps going on Low power past the week's money (doesn't stop)", () => {
    expect(computeEnergy([chat(WED - 30 * HOUR, 20)], WED, B, TZ).mode).toBe("low");
  });

  it("only rests at the hard stop ($48 by default)", () => {
    const rows = [chat(WED - 9 * 24 * HOUR, 30), desk(WED - 2 * 24 * HOUR, 17.9)];
    expect(computeEnergy(rows, WED, B, TZ).mode).not.toBe("resting");
    rows.push(chat(WED - HOUR, 0.2));
    const e = computeEnergy(rows, WED, B, TZ);
    expect(e.mode).toBe("resting");
    expect(e.limitedBy).toBe("month");
  });

  it("desk spending never takes chat energy", () => {
    expect(computeEnergy([desk(WED - HOUR, 5)], WED, B, TZ).percent).toBe(100);
  });

  it("honours custom budgets and the parent's split", () => {
    const b = Budgets.parse({ weeklyUsd: 20, deskSharePercent: 50, windowUsd: 5, rolloverCapUsd: 0 });
    expect(computeEnergy([chat(WED - 2 * HOUR, 2)], WED, b, TZ).percent).toBe(60);
  });
});

describe("desk energy (a daily slice of the week)", () => {
  const slice = (11.5 * 0.15) / 7;
  it("starts each day with its slice", () => {
    const mon = zonedTime(2026, 11, 23, 9, 0, TZ);
    const d = computeDeskEnergy([], mon, B, TZ);
    expect(d.usd.allowanceLeft).toBeCloseTo(slice);
    expect(d.canWork).toBe(true);
  });
  it("can't eat into chat, and stops when the slice is used", () => {
    const mon = zonedTime(2026, 11, 23, 18, 0, TZ);
    const d = computeDeskEnergy([desk(mon - HOUR, slice), chat(mon - HOUR, 5)], mon, B, TZ);
    expect(d.canWork).toBe(false);
  });
  it("rolls unused days forward within the week", () => {
    const d = computeDeskEnergy([], WED, B, TZ); // Mon, Tue, Wed slices unused
    expect(d.usd.allowanceLeft).toBeCloseTo(slice * 3);
    expect(d.percent).toBe(100);
  });
  it("drops to Low power near the end of the slice", () => {
    const mon = zonedTime(2026, 11, 23, 18, 0, TZ);
    expect(computeDeskEnergy([desk(mon - HOUR, slice * 0.9)], mon, B, TZ).mode).toBe("low");
  });
});

describe("parent figures", () => {
  it("projects the month from spending so far", () => {
    const mid = zonedTime(2026, 11, 16, 0, 0, TZ); // half of November gone
    expect(projectMonth(20, mid, TZ)).toBeCloseTo(40, 0);
  });
});
