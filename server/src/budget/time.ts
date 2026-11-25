// Time-zone helpers without dependencies. Weekly energy tops up at local midnight, so these
// work in the family's time zone, not the server's.

export interface LocalParts {
  year: number; month: number; day: number; hour: number; minute: number; weekday: number;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short", hourCycle: "h23",
    });
    fmtCache.set(tz, f);
  }
  return f;
}
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function localParts(ts: number, tz: string): LocalParts {
  const parts = Object.fromEntries(fmt(tz).formatToParts(new Date(ts)).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour), minute: Number(parts.minute), weekday: WD[parts.weekday as string],
  };
}

/** Offset (ms) between the zone's wall clock and UTC at a given instant. */
function offsetAt(ts: number, tz: string): number {
  const p = localParts(ts, tz);
  const secs = new Date(ts).getUTCSeconds();
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, secs);
  return asUtc - (ts - (ts % 1000));
}

/** The UTC instant of a local wall-clock time in `tz`. */
export function zonedTime(year: number, month: number, day: number, hour: number, minute: number, tz: string): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let ts = guess - offsetAt(guess, tz);
  // A second pass settles DST edges.
  ts = guess - offsetAt(ts, tz);
  return ts;
}

export function startOfDay(ts: number, tz: string): number {
  const p = localParts(ts, tz);
  return zonedTime(p.year, p.month, p.day, 0, 0, tz);
}

/** Most recent local midnight on `resetDay` (0 = Sunday), at or before `ts`. */
export function startOfWeek(ts: number, tz: string, resetDay: number): number {
  const p = localParts(ts, tz);
  const back = (p.weekday - resetDay + 7) % 7;
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day - back));
  return zonedTime(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 0, 0, tz);
}

export function nextWeekStart(ts: number, tz: string, resetDay: number): number {
  const start = startOfWeek(ts, tz, resetDay);
  const p = localParts(start, tz);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + 7));
  return zonedTime(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 0, 0, tz);
}

export function startOfMonth(ts: number, tz: string): number {
  const p = localParts(ts, tz);
  return zonedTime(p.year, p.month, 1, 0, 0, tz);
}

/** "HH:MM" → minutes after midnight. */
export function hm(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

/** True when the local time falls inside quiet hours (which may cross midnight). */
export function inQuietHours(ts: number, tz: string, quiet: { start: string; end: string }): boolean {
  const p = localParts(ts, tz);
  const t = p.hour * 60 + p.minute;
  const s = hm(quiet.start), e = hm(quiet.end);
  if (s === e) return false;
  return s < e ? t >= s && t < e : t >= s || t < e;
}

export function localDate(ts: number, tz: string): string {
  const p = localParts(ts, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}
