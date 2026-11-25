// Talks to Pip's desk container (see /desk). Everything the companion makes is kept there.

import { config } from "../config.js";

export interface ItemMeta {
  id: string; kind: string; title: string; icon: string; format: "html" | "md" | "svg" | "json";
  summary: string; favourite: boolean; characterIds: number[]; version: number; createdAt: number; updatedAt: number;
}

export class DeskError extends Error {
  constructor(message: string, readonly problems: string[] = []) { super(message); }
}

export class DeskClient {
  constructor(private base = config.desk.url, private token = config.desk.token) {}

  private async req<T>(method: string, p: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(this.base + p, {
        method,
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new DeskError("The desk isn't reachable right now.");
    }
    const j = (await res.json().catch(() => ({}))) as { problems?: string[]; error?: string };
    if (res.status === 422) throw new DeskError("The desk didn't keep it", j.problems ?? []);
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
  status() { return this.req<{ activity: string; progress: number; updatedAt: number }>("GET", "/status"); }
  setStatus(activity: string, progress: number) { return this.req("PUT", "/status", { activity, progress }).catch(() => undefined); }
}
