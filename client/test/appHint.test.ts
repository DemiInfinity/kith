import { afterEach, describe, expect, it, vi } from "vitest";

// Fakes just enough of a browser for appHint (node test environment).
function fakeBrowser(search: string, installed: boolean, stored: Record<string, string> = {}) {
  const store = { ...stored };
  vi.stubGlobal("window", { matchMedia: () => ({ matches: installed }) });
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("location", { search });
  vi.stubGlobal("localStorage", { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } });
  return store;
}
async function fresh() { vi.resetModules(); return import("../src/lib/appHint"); }
afterEach(() => vi.unstubAllGlobals());

describe("app hint", () => {
  it("an installed app takes ?app= from its start URL and remembers it", async () => {
    const store = fakeBrowser("?app=parent", true);
    const m = await fresh();
    expect(m.appHint()).toBe("parent");
    expect(store["kith-app"]).toBe("parent");
    expect(m.withApp("/auth/login")).toBe("/auth/login?app=parent");
    expect(m.withApp("/auth/login?handoff=x&json=1")).toBe("/auth/login?handoff=x&json=1&app=parent");
  });
  it("later launches without the query still know which app they are", async () => {
    fakeBrowser("", true, { "kith-app": "child" });
    expect((await fresh()).appHint()).toBe("child");
  });
  it("a normal browser tab has no hint, even with ?app=", async () => {
    const store = fakeBrowser("?app=parent", false);
    const m = await fresh();
    expect(m.appHint()).toBeNull();
    expect(store["kith-app"]).toBeUndefined();
    expect(m.withApp("/auth/login")).toBe("/auth/login");
  });
  it("the Mac apps say which one they are with window.__KITH_APP__", async () => {
    fakeBrowser("", false);
    vi.stubGlobal("__KITH_APP__", "parent");
    expect((await fresh()).appHint()).toBe("parent");
    vi.stubGlobal("__KITH_APP__", "admin");
    expect((await fresh()).appHint()).toBeNull();
  });
  it("ignores anything that isn't child or parent", async () => {
    fakeBrowser("?app=admin", true);
    expect((await fresh()).appHint()).toBeNull();
  });
  it("has friendly words for the wrong-app codes", async () => {
    fakeBrowser("", false);
    const m = await fresh();
    expect(m.wrongAppWords("use-parent-app")).toBe("This is the kids’ Kith. Grown-ups use Kith Parent.");
    expect(m.wrongAppWords("use-child-app")).toBe("This is the grown-ups’ app. Kids use Kith.");
    expect(m.wrongAppWords("not-allowed")).toBeNull();
  });
});
