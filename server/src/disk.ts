// The disk budget: Kith's own data (database, chat archive, block lists) plus the desk's files,
// against the parent's limits (15 GB in total and 5 GB for desk files, by default).

import fs from "node:fs";
import path from "node:path";
import type { DB } from "./db.js";
import { config } from "./config.js";
import { loadParentSettings } from "./settings.js";
import type { DeskClient } from "./desk/deskClient.js";

const GB = 1024 ** 3;

export function dirBytes(dir: string): number {
  let total = 0;
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    try {
      if (e.isDirectory()) total += dirBytes(p);
      else if (e.isFile()) total += fs.statSync(p).size;
    } catch { /* gone meanwhile */ }
  }
  return total;
}

export interface DiskUsage {
  data: number; desk: { items: number; trash: number; screenshots: number; browser: number; total: number } | null;
  total: number; totalCap: number; deskCap: number; keepDays: number; overTotal: boolean; overDesk: boolean;
}

let cache: { at: number; value: DiskUsage } | null = null;

/** Measures disk use (cached for a minute). */
export async function diskUsage(db: DB, desk: DeskClient, fresh = false): Promise<DiskUsage> {
  if (!fresh && cache && Date.now() - cache.at < 60_000) return cache.value;
  const d = loadParentSettings(db).disk;
  const data = dirBytes(config.dataDir);
  let deskU: DiskUsage["desk"] = null;
  try { deskU = await desk.usage(); } catch { /* desk asleep or unreachable */ }
  const total = data + (deskU?.total ?? 0);
  const value: DiskUsage = {
    data, desk: deskU, total, totalCap: d.totalGb * GB, deskCap: d.deskGb * GB, keepDays: d.keepDays,
    overTotal: total >= d.totalGb * GB, overDesk: (deskU?.items ?? 0) >= d.deskGb * GB,
  };
  cache = { at: Date.now(), value };
  return value;
}

/** Why new desk work can't start right now, if it can't. */
export function diskBlock(u: DiskUsage | null): string | null {
  if (!u) return null;
  if (u.overDesk) return "My desk is full. Delete some things on it to make room (or ask your grown-up to raise the limit).";
  if (u.overTotal) return "Kith is using all the disk space it's allowed. Your grown-up can make room or raise the limit.";
  return null;
}
export function resetDiskCache() { cache = null; }
