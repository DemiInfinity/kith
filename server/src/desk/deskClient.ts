// Talks to Pip's desk container (see /desk). Everything the companion makes is kept there.

import { config } from "../config.js";

export interface ItemMeta {
  id: string; kind: string; title: string; icon: string; format: "html" | "md" | "svg" | "json";
  summary: string; favourite: boolean; characterIds: number[]; version: number; createdAt: number; updatedAt: number;
}

export interface LiveView { busy: boolean; url: string; title: string; why: string; jobId: number | null; ts: number; frame: string; takenOverBy?: string | null; cursor?: { x: number; y: number }; robotCheck?: boolean; signIn?: boolean; tabs?: { title: string; url: string }[]; active?: number }

export class DeskError extends Error {
  constructor(message: string, readonly problems: string[] = []) { super(message); }
}

export class DeskClient {
  constructor(private base = config.desk.url, private token = config.desk.token) {}

  private async req<T>(method: string, p: string, body?: unknown, timeout = 15_000): Promise<T> {
    let res: Response;
    try {
      res = await fetch(this.base + p, {
        method,
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      });
    } catch {
      throw new DeskError("The desk isn't reachable right now.");
    }
    const j = (await res.json().catch(() => ({}))) as { problems?: string[]; error?: string };
    if (res.status === 422) throw new DeskError(j.error ?? "The desk didn't keep it", j.problems ?? []);
    if (!res.ok) throw new DeskError(j.error ?? `Desk answered ${res.status}`);
    return j as T;
  }

  list() { return this.req<ItemMeta[]>("GET", "/items"); }
  read(id: string, v?: number) {
    return this.req<{ meta: ItemMeta; content: string; versions: number[] }>("GET", `/items/${encodeURIComponent(id)}${v ? `?v=${v}` : ""}`);
  }
  create(item: { kind: string; title: string; icon: string; format: ItemMeta["format"]; summary: string; characterIds?: number[]; content: string }) {
    return this.req<ItemMeta>("POST", "/items", item);
  }
  update(id: string, item: { title?: string; summary?: string; content: string }) {
    return this.req<ItemMeta>("PUT", `/items/${encodeURIComponent(id)}`, item);
  }
  favourite(id: string, favourite: boolean) { return this.req<ItemMeta>("PUT", `/items/${encodeURIComponent(id)}/favourite`, { favourite }); }
  remove(id: string) { return this.req<{ ok: boolean }>("DELETE", `/items/${encodeURIComponent(id)}`); }
  browse(url: string, why: string, jobId: number | null, rules: DeskRules) {
    return this.req<{ url: string; title: string; text: string }>("POST", "/browse", { url, why, jobId, rules }, 45_000);
  }
  takeOver(who: string, rules: DeskRules, url?: string, name?: string) {
    return this.req<LiveView>("POST", "/browser/takeover", { who, rules, url, name }, 45_000);
  }
  act(a: DeskAction) {
    return this.req<LiveView & { navigated: boolean }>("POST", "/browser/action", a, 30_000);
  }
  clearBrowser() { return this.req<{ ok: boolean }>("POST", "/browser/clear", {}, 30_000); }
  release() { return this.req<{ ok: boolean }>("POST", "/browser/release", {}); }
  live() { return this.req<LiveView>("GET", "/browser/live"); }
  status() { return this.req<{ activity: string; progress: number; updatedAt: number }>("GET", "/status"); }
  setStatus(activity: string, progress: number) { return this.req("PUT", "/status", { activity, progress }).catch(() => undefined); }
}

/** What the desk browser checks itself (the egress proxy also applies the big public list). */
export interface DeskRules { mode: "blocklist" | "safelist"; sites: string[]; assetHosts: string[]; blocked: string[]; words: string[] }

export interface DeskAction {
  type: "go" | "click" | "scroll" | "back" | "forward" | "reload" | "move" | "home" | "newtab" | "tab" | "closetab" | "type" | "key";
  url?: string; x?: number; y?: number; dy?: number; index?: number; text?: string; key?: string;
}
