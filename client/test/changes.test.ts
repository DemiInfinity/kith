import { describe, expect, it } from "vitest";
import { outcome } from "../src/components/ChangeCard";
import type { PipChange } from "../src/api";

const change = (o: Partial<PipChange>): PipChange => ({ id: 1, ts: 0, kind: "soul", status: "pending", title: "", lines: [], why: "", result: "", canUndo: false, ...o });

describe("Pip's change cards after a reload", () => {
  it("say how a soul or memory proposal ended", () => {
    expect(outcome(change({ status: "pending" }))).toBe("");
    expect(outcome(change({ status: "accepted" }))).toMatch(/soul’s changed/);
    expect(outcome(change({ status: "declined" }))).toMatch(/left my soul/);
    expect(outcome(change({ status: "expired" }))).toMatch(/ran out/);
    expect(outcome(change({ kind: "memory", status: "accepted" }), "Nova")).toBe("Remembered. You can see it in What Nova remembers.");
    expect(outcome(change({ kind: "memory", status: "declined" }))).toMatch(/won’t remember/);
  });
  it("say when a tweak was undone", () => {
    expect(outcome(change({ kind: "personality", status: "applied", canUndo: true }))).toBe("");
    expect(outcome(change({ kind: "checkins", status: "undone" }))).toMatch(/back how it was/);
  });
});
