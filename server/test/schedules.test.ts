import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.js";
import { addSchedule, dueSchedules, listSchedules, markRan, nextRun, parseLocal, MAX_ACTIVE } from "../src/companion/schedules.js";

const TZ = "Europe/London";
const quiet = { start: "22:00", end: "07:00" };
const at = (s: string) => parseLocal(s, TZ);

describe("things she asks to schedule", () => {
  it("one-off reminders run once, then switch off", () => {
    const db = openDb(":memory:");
    const now = at("2026-11-25T16:00");
    const r = addSchedule(db, { title: "Revise fractions", kind: "reminder", when: "2026-11-25T19:00", repeat: "none" }, TZ, now);
    expect(r.ok).toBe(true);
    const due = dueSchedules(listSchedules(db), at("2026-11-25T19:01"), TZ, quiet);
    expect(due.map((d) => d.title)).toEqual(["Revise fractions"]);
    markRan(db, due[0], at("2026-11-25T19:01"), TZ);
    expect(listSchedules(db)[0].active).toBe(0);
  });
  it("repeats daily, on weekdays or weekly", () => {
    const wed = at("2026-11-25T19:00");
    expect(nextRun(wed, "daily", TZ)).toBe(at("2026-11-26T19:00"));
    expect(nextRun(at("2026-11-27T19:00"), "weekdays", TZ)).toBe(at("2026-11-30T19:00")); // Fri → Mon
    expect(nextRun(wed, "weekly", TZ)).toBe(at("2026-12-02T19:00"));
  });
  it("never sends reminders in quiet hours (they wait)", () => {
    const db = openDb(":memory:");
    addSchedule(db, { title: "Late one", kind: "reminder", when: "2026-11-25T23:00", repeat: "none" }, TZ, at("2026-11-25T16:00"));
    expect(dueSchedules(listSchedules(db), at("2026-11-25T23:30"), TZ, quiet)).toHaveLength(0);
    expect(dueSchedules(listSchedules(db), at("2026-11-26T07:05"), TZ, quiet)).toHaveLength(1);
  });
  it("refuses times in the past and too many at once", () => {
    const db = openDb(":memory:");
    const now = at("2026-11-25T16:00");
    expect(addSchedule(db, { title: "x", kind: "reminder", when: "2026-11-24T10:00", repeat: "none" }, TZ, now).ok).toBe(false);
    for (let i = 0; i < MAX_ACTIVE; i++) addSchedule(db, { title: `r${i}`, kind: "reminder", when: "2026-11-26T10:00", repeat: "none" }, TZ, now);
    expect(addSchedule(db, { title: "one more", kind: "reminder", when: "2026-11-26T10:00", repeat: "none" }, TZ, now).ok).toBe(false);
  });
  it("'make' needs to say what to make", () => {
    const db = openDb(":memory:");
    expect(addSchedule(db, { title: "Quiz", kind: "make", when: "2026-11-29T10:00", repeat: "weekly" }, TZ, at("2026-11-25T16:00")).ok).toBe(false);
    expect(addSchedule(db, { title: "Quiz", kind: "make", when: "2026-11-29T10:00", repeat: "weekly", make: { kind: "quiz", brief: "this week's topics" } }, TZ, at("2026-11-25T16:00")).ok).toBe(true);
  });
});
