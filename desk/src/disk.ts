// Disk use on the desk: how much each part takes, a hard cap on desk files, and tidying up.
// - items: what the companion made (kept until deleted; capped at DESK_MAX_GB, 5 GB by default)
// - trash: deleted items, kept for a few days in case, then removed
// - screenshots: none are saved today (the live view is kept in memory only); anything put here
//   is removed after the same few days
// - browser: the desk browser's cookies and site data (its caches are cleared whenever it stops)

import fs from "node:fs";
import path from "node:path";

const DAY = 86_400_000;
export const DESK_MAX_BYTES = Math.round(Number(process.env.DESK_MAX_GB ?? 5) * 1024 ** 3);

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

export function usage(root: string) {
  const parts = {
    items: dirBytes(path.join(root, "items")),
    trash: dirBytes(path.join(root, "trash")),
    screenshots: dirBytes(path.join(root, "screenshots")),
    browser: dirBytes(path.join(root, "browser")),
  };
  return { ...parts, total: parts.items + parts.trash + parts.screenshots + parts.browser, capItems: DESK_MAX_BYTES };
}

/** Removes trash and screenshots older than `keepDays`. Returns how many bytes were freed. */
export function tidy(root: string, keepDays = 7, now = Date.now()): number {
  let freed = 0;
  for (const sub of ["trash", "screenshots"]) {
    const dir = path.join(root, sub);
    let names: string[];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) {
      const p = path.join(dir, n);
      try {
        const st = fs.statSync(p);
        if (now - st.mtimeMs < keepDays * DAY) continue;
        const size = st.isDirectory() ? dirBytes(p) : st.size;
        fs.rmSync(p, { recursive: true, force: true });
        freed += size;
      } catch { /* skip */ }
    }
  }
  return freed;
}

/** Chromium's caches (safe to delete; cookies and site data stay). */
export function clearBrowserCaches(profile: string) {
  for (const sub of ["Default/Cache", "Default/Code Cache", "Default/GPUCache", "GrShaderCache", "ShaderCache", "Default/Service Worker/CacheStorage"]) {
    fs.rmSync(path.join(profile, sub), { recursive: true, force: true });
  }
}
