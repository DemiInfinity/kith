import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { scanItem } from "./scan.js";

export const FORMATS = ["html", "md", "svg", "json"] as const;
export type Format = (typeof FORMATS)[number];

export interface ItemMeta {
  id: string;
  kind: string;          // story, quiz, flashcards, game, sketch, palette, character, map, timeline…
  title: string;
  icon: string;
  format: Format;
  summary: string;
  favourite: boolean;
  characterIds: number[];
  version: number;
  createdAt: number;
  updatedAt: number;
}

const ID = /^[a-z0-9-]{4,64}$/;

export class DeskStore {
  constructor(private dir: string) {
    fs.mkdirSync(path.join(dir, "items"), { recursive: true });
    fs.mkdirSync(path.join(dir, "trash"), { recursive: true });
  }

  private itemDir(id: string) {
    if (!ID.test(id)) throw new Error("bad id");
    return path.join(this.dir, "items", id);
  }

  list(): ItemMeta[] {
    return fs
      .readdirSync(path.join(this.dir, "items"))
      .filter((id) => ID.test(id))
      .map((id) => this.meta(id))
      .filter((m): m is ItemMeta => m !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  meta(id: string): ItemMeta | null {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.itemDir(id), "meta.json"), "utf8"));
    } catch {
      return null;
    }
  }

  read(id: string, version?: number): { meta: ItemMeta; content: string; versions: number[] } | null {
    const meta = this.meta(id);
    if (!meta) return null;
    const v = version ?? meta.version;
    const file = path.join(this.itemDir(id), `v${v}.${meta.format}`);
    if (!fs.existsSync(file)) return null;
    const versions = fs.readdirSync(this.itemDir(id)).map((f) => /^v(\d+)\./.exec(f)?.[1]).filter(Boolean).map(Number).sort((a, b) => a - b);
    return { meta, content: fs.readFileSync(file, "utf8"), versions };
  }

  /** Create (no id) or add a new version. Returns problems if the scan fails. */
  write(input: { id?: string; kind: string; title: string; icon?: string; format: Format; summary?: string; characterIds?: number[]; content: string }) {
    if (!FORMATS.includes(input.format)) return { ok: false as const, problems: ["unknown format"] };
    const scan = scanItem(input.format, input.content);
    if (!scan.ok) return { ok: false as const, problems: scan.problems };
    const now = Date.now();
    const existing = input.id ? this.meta(input.id) : null;
    const id = existing?.id ?? input.id ?? `${slug(input.title)}-${crypto.randomBytes(3).toString("hex")}`;
    const meta: ItemMeta = {
      id,
      kind: input.kind.slice(0, 30),
      title: input.title.slice(0, 80),
      icon: (input.icon ?? existing?.icon ?? "📄").slice(0, 8),
      format: input.format,
      summary: (input.summary ?? existing?.summary ?? "").slice(0, 200),
      favourite: existing?.favourite ?? false,
      characterIds: input.characterIds ?? existing?.characterIds ?? [],
      version: (existing?.version ?? 0) + 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const dir = this.itemDir(id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `v${meta.version}.${meta.format}`), input.content);
    fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
    return { ok: true as const, meta };
  }

  setFavourite(id: string, favourite: boolean) {
    const meta = this.meta(id);
    if (!meta) return null;
    meta.favourite = favourite;
    fs.writeFileSync(path.join(this.itemDir(id), "meta.json"), JSON.stringify(meta, null, 2));
    return meta;
  }

  /** Moves an item to the desk's bin (kept so a grown-up can still see what was there). */
  remove(id: string) {
    const dir = this.itemDir(id);
    if (!fs.existsSync(dir)) return false;
    fs.renameSync(dir, path.join(this.dir, "trash", `${id}-${Date.now()}`));
    return true;
  }
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "item";
}
