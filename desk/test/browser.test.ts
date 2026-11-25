import { describe, expect, it } from "vitest";
import { capTabs } from "../src/browser.js";

describe("desk browser tabs", () => {
  it("a 9th tab closes the oldest straight away, without waiting for close events", () => {
    // Fake tabs whose close() resolves later and never touches the list (like Playwright's async close).
    const closed: number[] = [];
    const tabs = Array.from({ length: 9 }, (_, i) => ({ i, close: () => new Promise<void>((r) => setTimeout(() => { closed.push(i); r(); }, 10)) }));
    const removed = capTabs(tabs, 8);
    expect(removed.map((t) => t.i)).toEqual([0]);
    expect(tabs).toHaveLength(8);
    expect(tabs[0].i).toBe(1);
    for (const t of removed) void t.close();
  });
  it("trims several at once and leaves short lists alone", () => {
    const list = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    expect(capTabs(list, 8)).toEqual([1, 2, 3]);
    expect(list).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
    expect(capTabs(list, 8)).toEqual([]);
    expect(capTabs([1, 2], 8)).toEqual([]);
  });
});
