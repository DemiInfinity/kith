// Where things the companion makes are kept. The desk (on the home server) always holds
// everything; cloud backends are optional extra homes. Google Drive (the child's own account) is the
// first. With nothing connected, the desk alone is used.

import type { DB } from "../db.js";
import { all, run } from "../db.js";
import { loadParentSettings } from "../settings.js";
import { redactPersonal } from "../safety/rules.js";
import { folderFor, GoogleDrive, googleConfigured, loadGoogle, saveToDrive, type MirrorInput } from "./google.js";
import { logActivity } from "../desk/activity.js";

export interface CloudBackend {
  readonly name: string;
  /** Connected, switched on by the parent, and configured. */
  ready(): boolean;
  save(item: MirrorInput): Promise<{ url: string; extra?: string }>;
}

export function toolLogger(db: DB, connection: string) {
  return (tool: string, args: string, result: string, ok: boolean) =>
    run(db, "INSERT INTO tool_log(ts, connection, tool, level, args, result, ok) VALUES (?,?,?,?,?,?,?)",
      Date.now(), connection, tool, "act", redactPersonal(args).text.slice(0, 400), result.slice(0, 400), ok ? 1 : 0);
}

export class GoogleBackend implements CloudBackend {
  readonly name = "google";
  readonly drive: GoogleDrive;
  constructor(private db: DB, fetchImpl: typeof fetch = fetch) {
    this.drive = new GoogleDrive(db, toolLogger(db, "Google Drive"), fetchImpl);
  }
  connection() {
    return loadParentSettings(this.db).connections.find((c) => c.kind === "google-drive");
  }
  ready() {
    return googleConfigured() && !!loadGoogle(this.db) && !!this.connection()?.enabled;
  }
  async save(item: MirrorInput) {
    const parentEmail = this.connection()?.account ?? "";
    const out = await saveToDrive(this.drive, item);
    if (parentEmail) await this.drive.shareWithParent(parentEmail).catch((e) => toolLogger(this.db, "Google Drive")("share_kith_folder", parentEmail, (e as Error).message, false));
    return out;
  }
}

export class Storage {
  constructor(private db: DB, readonly backends: CloudBackend[]) {}

  get google() {
    return this.backends.find((b): b is GoogleBackend => b instanceof GoogleBackend) ?? null;
  }

  /** Copies a desk item to every ready backend. Never throws: the desk copy is what counts. */
  async mirror(itemId: string, item: MirrorInput) {
    const links: { provider: string; url: string; extra?: string }[] = [];
    for (const b of this.backends) {
      if (!b.ready()) continue;
      try {
        const r = await b.save(item);
        run(this.db, "INSERT INTO cloud_links(ts, item_id, version, provider, url, extra) VALUES (?,?,?,?,?,?)", Date.now(), itemId, item.version, b.name, r.url, r.extra ?? null);
        links.push({ provider: b.name, ...r });
        logActivity(this.db, "☁︎", `Saved “${item.title}”${item.version > 1 ? ` (v${item.version})` : ""} to Kith / ${folderFor(item.kind, item.characterIds)}`);
      } catch (err) {
        toolLogger(this.db, b.name === "google" ? "Google Drive" : b.name)("save", item.title, (err as Error).message, false);
      }
    }
    return links;
  }

  links(itemId?: string) {
    return itemId
      ? all<{ item_id: string; version: number; provider: string; url: string; extra: string | null }>(this.db, "SELECT item_id, version, provider, url, extra FROM cloud_links WHERE item_id = ? ORDER BY version DESC", itemId)
      : all<{ item_id: string; version: number; provider: string; url: string; extra: string | null }>(this.db, "SELECT item_id, version, provider, url, extra FROM cloud_links ORDER BY ts DESC");
  }
}
