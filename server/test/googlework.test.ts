import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db.js";
import { config } from "../src/config.js";
import { allowedCall, authUrl, CALENDAR_SCOPE, exchangeCode, GoogleDrive, googleConfigured, MIME, rememberFile, saveGoogle, scopesFor, seal, TASKS_SCOPE, viaConnect } from "../src/storage/google.js";
import { loadParentSettings, saveParentSettings } from "../src/settings.js";
import { apply, decline, need, pendingList, proposeCalendar, proposeFileEdit, proposeTask, readFile, setCoursework } from "../src/storage/googleWork.js";
import { googleTools } from "../src/companion/googleTools.js";

process.env.KITH_SECRET_KEY = "a".repeat(64);
config.google.clientId = "client";
config.google.clientSecret = "secret";

const DOC = "doc1234567890";
const SHEET = "sheet1234567890";
interface Call { url: string; method: string; body: string }
function fakeGoogle(events: Record<string, { kith: boolean }> = {}) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? init.body : init.body instanceof URLSearchParams ? init.body.toString() : "";
    calls.push({ url, method, body });
    const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
    if (url.includes("oauth2.googleapis.com/token")) return json({ access_token: "at", expires_in: 3600 });
    const ev = /calendars\/primary\/events\/([A-Za-z0-9_-]+)/.exec(url);
    if (ev && method === "GET") return json({ id: ev[1], summary: "x", extendedProperties: events[ev[1]]?.kith ? { private: { kith: "1" } } : {} });
    if (url.includes("docs.googleapis.com") && method === "GET") return json({ body: { content: [{ paragraph: { elements: [{ textRun: { content: "My essay\n" } }] } }] } });
    if (url.includes("users/@me/lists") && method === "GET") return json({ items: [{ id: "hwlist1", title: "Homework" }] });
    if (url.includes("/tasks?") && method === "GET") return json({ items: [{ id: "task1234", title: "Maths p.12", due: "2026-11-27T00:00:00.000Z" }] });
    return json({ id: "new1234" });
  }) as unknown as typeof fetch;
  return { f, calls, writes: () => calls.filter((c) => c.method !== "GET" && !c.url.includes("oauth2")) };
}
function setFeatures(db: DB, f: { edit?: boolean; calendar?: boolean; tasks?: boolean }, enabled = true) {
  const s = loadParentSettings(db);
  s.connections = s.connections.map((c) => (c.kind === "google-drive" ? { ...c, enabled, features: { edit: false, calendar: false, tasks: false, ...f } } : c));
  saveParentSettings(db, s);
}

let db: DB;
beforeEach(() => {
  db = openDb(":memory:");
  saveGoogle(db, { email: "kid@gmail.com", refresh: seal("rt"), connectedAt: 0, folders: {}, sharedWith: "", scopes: scopesFor({ calendar: true, tasks: true }) });
  rememberFile(db, DOC, "Story", MIME.doc, "picked");
  rememberFile(db, SHEET, "Revision", MIME.sheet, "created");
});

describe("scopes", () => {
  it("asks for drive.file only, plus Calendar and Tasks just when they're switched on; never Gmail and the like", () => {
    expect(scopesFor()).toEqual(["openid", "email", "https://www.googleapis.com/auth/drive.file"]);
    const all = scopesFor({ edit: true, calendar: true, tasks: true });
    expect(all).toEqual([...scopesFor(), CALENDAR_SCOPE, TASKS_SCOPE]);
    expect(all.join(" ")).not.toMatch(/gmail|contacts|photos|classroom|auth\/drive(\.readonly)?( |$)|auth\/calendar( |$)/);
  });
  it("still refuses a sign-in that grants more than was asked", async () => {
    const id = `x.${Buffer.from(JSON.stringify({ email: "kid@gmail.com", email_verified: true })).toString("base64url")}.y`;
    const respond = (scope: string) => (async () => new Response(JSON.stringify({ refresh_token: "r", access_token: "a", id_token: id, scope }), { status: 200 })) as unknown as typeof fetch;
    const asked = scopesFor({ calendar: true });
    expect((await exchangeCode("c", "v", respond(asked.join(" ")), asked)).scopes).toContain(CALENDAR_SCOPE);
    await expect(exchangeCode("c", "v", respond([...asked, "https://www.googleapis.com/auth/gmail.readonly"].join(" ")), asked)).rejects.toThrow(/more than Kith asked/);
    await expect(exchangeCode("c", "v", respond([...scopesFor(), TASKS_SCOPE].join(" ")), scopesFor())).rejects.toThrow(/more than Kith asked/);
  });
});

describe("the call guard", () => {
  it("never deletes, patches, moves or re-shares files", () => {
    expect(allowedCall("DELETE", "https://www.googleapis.com/drive/v3/files/abc1234567")).toBe(false);
    expect(allowedCall("PATCH", "https://www.googleapis.com/drive/v3/files/abc1234567?addParents=x")).toBe(false);
    expect(allowedCall("PUT", "https://sheets.googleapis.com/v4/spreadsheets/x/values/A1")).toBe(false);
    expect(allowedCall("POST", "https://www.googleapis.com/drive/v3/files/abc/permissions")).toBe(false);
    expect(allowedCall("POST", "https://docs.googleapis.com/v1/documents/abc:batchUpdate")).toBe(true);
    expect(allowedCall("DELETE", "https://www.googleapis.com/calendar/v3/calendars/primary/events/ev123?sendUpdates=none")).toBe(true);
    expect(allowedCall("DELETE", "https://www.googleapis.com/calendar/v3/calendars/other@x/events/ev123")).toBe(false);
  });
  it("is enforced on every call", async () => {
    const g = fakeGoogle();
    const drive = new GoogleDrive(db, () => undefined, g.f);
    await expect(drive.call("https://www.googleapis.com/drive/v3/files/abc1234567", { method: "DELETE" })).rejects.toThrow(/never/);
    expect(g.calls).toEqual([]);
  });
});

describe("switches", () => {
  it("are all off by default, and each feature needs its own", async () => {
    expect(() => need(db, "edit")).toThrow(/hasn't switched on/);
    setFeatures(db, { calendar: true });
    expect(() => need(db, "edit")).toThrow(/editing Docs/);
    expect(() => need(db, "calendar")).not.toThrow();
    expect(() => need(db, "tasks")).toThrow(/Homework/);
    setFeatures(db, { calendar: true }, false);
    expect(() => need(db, "calendar")).toThrow(); // Google switched off altogether
  });
  it("ask her to connect again when the sign-in doesn't cover a new feature", () => {
    saveGoogle(db, { email: "kid@gmail.com", refresh: seal("rt"), connectedAt: 0, folders: {}, sharedWith: "", scopes: scopesFor() });
    setFeatures(db, { calendar: true });
    expect(() => need(db, "calendar")).toThrow(/connect Google again/);
  });
  it("decide which tools the companion gets", () => {
    const g = fakeGoogle();
    const drive = new GoogleDrive(db, () => undefined, g.f);
    expect(googleTools(db, drive, { confirms: [] }, { coursework: false })).toEqual([]);
    setFeatures(db, { tasks: true });
    expect(googleTools(db, drive, { confirms: [] }, { coursework: false }).map((t) => t.name)).toEqual(["homework_list", "homework_propose"]);
    setFeatures(db, { edit: true, calendar: true, tasks: true });
    expect(googleTools(db, drive, { confirms: [] }, { coursework: false })).toHaveLength(8);
  });
});

describe("files", () => {
  beforeEach(() => setFeatures(db, { edit: true }));
  it("reads only files she picked or Kith made", async () => {
    const g = fakeGoogle();
    const drive = new GoogleDrive(db, () => undefined, g.f);
    expect(await readFile(db, drive, DOC)).toContain("My essay");
    await expect(readFile(db, drive, "unpicked1234567")).rejects.toThrow(/picked for me/);
  });
  it("writes nothing until she says yes, then edits with a batchUpdate (no PUT, no new file)", async () => {
    const g = fakeGoogle();
    const drive = new GoogleDrive(db, () => undefined, g.f);
    const p = proposeFileEdit(db, { fileId: DOC, summary: "Fix the ending", changes: [{ op: "replace", find: "teh", with: "the" }, { op: "append", text: "The end." }] });
    expect(p.lines.map((l) => l.op)).toEqual(["·", "-", "+", "+"]);
    expect(g.writes()).toEqual([]);
    expect(pendingList(db).map((x) => x.id)).toEqual([p.id]);
    const r = await apply(db, drive, p.id);
    expect(r.ok).toBe(true);
    expect(r.message).toContain("Version history");
    expect(g.writes().map((c) => `${c.method} ${c.url}`)).toEqual([`POST https://docs.googleapis.com/v1/documents/${DOC}:batchUpdate`]);
    expect(JSON.parse(g.writes()[0].body).requests[0]).toEqual({ replaceAllText: { containsText: { text: "teh", matchCase: true }, replaceText: "the" } });
    // A yes only works once.
    expect((await apply(db, drive, p.id)).ok).toBe(false);
  });
  it("applies once even if she taps Yes twice at the same moment", async () => {
    const g = fakeGoogle();
    const drive = new GoogleDrive(db, () => undefined, g.f);
    const p = proposeFileEdit(db, { fileId: DOC, summary: "Fix", changes: [{ op: "append", text: "The end." }] });
    const results = await Promise.all([apply(db, drive, p.id), apply(db, drive, p.id)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(g.writes()).toHaveLength(1);
  });
  it("can be declined, and then nothing happens", async () => {
    const g = fakeGoogle();
    const p = proposeFileEdit(db, { fileId: SHEET, summary: "Add two words", changes: [{ op: "append_rows", rows: [["el gato", "the cat"]] }] });
    expect(decline(db, p.id)).toBe(true);
    expect((await apply(db, new GoogleDrive(db, () => undefined, g.f), p.id)).ok).toBe(false);
    expect(g.writes()).toEqual([]);
  });
  it("refuses unpicked files and anything marked as coursework, even on apply", async () => {
    expect(() => proposeFileEdit(db, { fileId: "unpicked1234567", summary: "x", changes: [{ op: "append", text: "x" }] })).toThrow(/picked for me/);
    expect(() => proposeFileEdit(db, { fileId: DOC, summary: "x", changes: [{ op: "append", text: "x" }], coursework: true })).toThrow(/coursework/);
    const p = proposeFileEdit(db, { fileId: DOC, summary: "x", changes: [{ op: "append", text: "x" }] });
    setCoursework(db, DOC, true);
    const g = fakeGoogle();
    const r = await apply(db, new GoogleDrive(db, () => undefined, g.f), p.id);
    expect(r).toMatchObject({ ok: false });
    expect(r.message).toMatch(/coursework/);
    expect(g.writes()).toEqual([]);
  });
  it("uses only the operations each kind of file allows", () => {
    expect(() => proposeFileEdit(db, { fileId: SHEET, summary: "x", changes: [{ op: "append", text: "x" }] })).toThrow();
    expect(() => proposeFileEdit(db, { fileId: DOC, summary: "x", changes: [{ op: "delete_file" }] })).toThrow();
  });
});

describe("calendar", () => {
  beforeEach(() => setFeatures(db, { calendar: true }));
  it("creates only after a yes, tagged as Kith's, with no guests and no emails", async () => {
    const g = fakeGoogle();
    const drive = new GoogleDrive(db, () => undefined, g.f);
    const p = await proposeCalendar(db, drive, { op: "create", title: "Revise French", start: "2026-11-28T16:00" });
    expect(g.writes()).toEqual([]);
    await apply(db, drive, p.id);
    const w = g.writes()[0];
    expect(w.url).toContain("sendUpdates=none");
    const body = JSON.parse(w.body);
    expect(body.attendees).toEqual([]);
    expect(body.extendedProperties.private.kith).toBe("1");
  });
  it("refuses guests outright", async () => {
    const drive = new GoogleDrive(db, () => undefined, fakeGoogle().f);
    await expect(proposeCalendar(db, drive, { op: "create", title: "Party", start: "2026-11-28", attendees: ["friend@x.com"] })).rejects.toThrow(/never invite/);
  });
  it("changes or deletes only events Kith made", async () => {
    const g = fakeGoogle({ kithev1: { kith: true }, herev12: { kith: false } });
    const drive = new GoogleDrive(db, () => undefined, g.f);
    await expect(proposeCalendar(db, drive, { op: "delete", eventId: "herev12" })).rejects.toThrow(/only change or remove events I added/);
    const p = await proposeCalendar(db, drive, { op: "delete", eventId: "kithev1" });
    expect((await apply(db, drive, p.id)).ok).toBe(true);
    expect(g.writes().map((c) => c.method)).toEqual(["DELETE"]);
  });
});

describe("homework", () => {
  it("adds and ticks off only after a yes", async () => {
    setFeatures(db, { tasks: true });
    const g = fakeGoogle();
    const drive = new GoogleDrive(db, () => undefined, g.f);
    const a = proposeTask(db, { op: "add", title: "French vocab", due: "2026-11-30" });
    const c = proposeTask(db, { op: "complete", taskId: "task1234", title: "Maths p.12" });
    expect(g.writes()).toEqual([]);
    await apply(db, drive, a.id);
    await apply(db, drive, c.id);
    expect(g.writes().map((x) => `${x.method} ${x.url.split("/tasks/v1")[1]}`)).toEqual(["POST /lists/hwlist1/tasks", "PATCH /lists/hwlist1/tasks/task1234"]);
  });
  it("is refused while the switch is off", () => {
    expect(() => proposeTask(db, { op: "add", title: "x" })).toThrow(/hasn't switched on/);
  });
});

describe("Kith Connect (the shared sign-in helper)", () => {
  const own = { id: config.google.clientId, secret: config.google.clientSecret };
  const useConnect = () => { config.google.clientId = ""; config.google.clientSecret = ""; config.google.connectUrl = "https://kith-connect.example"; };
  const restore = () => { config.google.clientId = own.id; config.google.clientSecret = own.secret; config.google.connectUrl = ""; };
  it("is used only when there's no own client, and your own client wins", () => {
    expect(viaConnect()).toBe(false);
    useConnect();
    expect(viaConnect()).toBe(true);
    expect(googleConfigured()).toBe(true);
    config.google.clientId = "mine"; config.google.clientSecret = "s";
    expect(viaConnect()).toBe(false);
    restore();
  });
  it("starts sign-in at the helper, which returns to this Kith's own callback", () => {
    useConnect();
    const u = new URL(authUrl("state-abcdefghijklmnop", "c".repeat(43), scopesFor({ calendar: true })));
    expect(u.origin + u.pathname).toBe("https://kith-connect.example/api/start");
    expect(u.searchParams.get("return")).toBe(`${config.publicUrl}/auth/google/callback`);
    expect(u.searchParams.get("scope")).toContain(CALENDAR_SCOPE);
    expect(u.searchParams.get("client_secret")).toBeNull();
    restore();
  });
  it("swaps the code and refreshes through the helper, never sending a secret", async () => {
    useConnect();
    const id = `x.${Buffer.from(JSON.stringify({ email: "kid@gmail.com", email_verified: true })).toString("base64url")}.y`;
    const calls: { url: string; body: string }[] = [];
    const f = (async (url: string, init: RequestInit = {}) => {
      calls.push({ url, body: String(init.body ?? "") });
      if (url.endsWith("/api/token")) return new Response(JSON.stringify({ refresh_token: "rt", access_token: "at", id_token: id, scope: scopesFor().join(" ") }), { status: 200 });
      if (url.endsWith("/api/refresh")) return new Response(JSON.stringify({ access_token: "fresh", expires_in: 3600 }), { status: 200 });
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    const t = await exchangeCode("4/code", "v".repeat(43), f, scopesFor());
    expect(t.email).toBe("kid@gmail.com");
    expect(JSON.parse(calls[0].body)).toEqual({ code: "4/code", verifier: "v".repeat(43) });
    const drive = new GoogleDrive(db, () => undefined, f);
    await drive.call("https://www.googleapis.com/calendar/v3/calendars/primary/events?x=1");
    expect(calls[1].url).toBe("https://kith-connect.example/api/refresh");
    expect(JSON.parse(calls[1].body)).toEqual({ refresh_token: "rt" });
    expect(calls.some((c) => c.body.includes("secret"))).toBe(false);
    restore();
  });
});
