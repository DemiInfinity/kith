// The Mac app bridge (src/lib/native.ts): nothing happens in a browser; in the app, Pip's
// requests to add things go through the app's native prompt and the answer goes back.

import { afterEach, describe, expect, it, vi } from "vitest";

const g = globalThis as unknown as { window?: unknown; fetch: typeof fetch };

afterEach(() => {
  delete g.window;
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("the Mac app bridge", () => {
  it("is off in a normal browser", async () => {
    g.window = {};
    const n = await import("../src/lib/native");
    expect(n.isMacApp()).toBe(false);
    await expect(n.pickDocument()).rejects.toThrow("Only in the Kith Mac app.");
  });

  it("asks her on the Mac for each thing Pip wants to add, and reports her answer", async () => {
    const invoked: [string, unknown][] = [];
    g.window = {
      __TAURI__: {
        core: { invoke: async (cmd: string, args: unknown) => { invoked.push([cmd, args]); return cmd === "native_add_event"; } },
        event: { listen: async () => () => undefined },
      },
    };
    const posted: [string, unknown][] = [];
    g.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/native/actions") {
        return new Response(JSON.stringify({ actions: [
          { id: 1, kind: "event", title: "Revise fractions", start: 1, end: 2, allDay: false },
          { id: 2, kind: "reminder", title: "Pack PE kit", due: null },
        ] }), { headers: { "content-type": "application/json" } });
      }
      posted.push([url, JSON.parse(String(init?.body))]);
      return new Response("{}", { headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const n = await import("../src/lib/native");
    expect(n.isMacApp()).toBe(true);
    await n.checkNativeActions();
    expect(invoked).toEqual([
      ["native_add_event", { event: { title: "Revise fractions", start: 1, end: 2, allDay: false } }],
      ["native_add_reminder", { reminder: { title: "Pack PE kit", due: null } }],
    ]);
    expect(posted).toEqual([["/api/native/actions/1", { result: "added" }], ["/api/native/actions/2", { result: "declined" }]]);
  });
});
