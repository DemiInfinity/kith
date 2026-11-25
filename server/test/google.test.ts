import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db.js";
import { config } from "../src/config.js";
import {
  exchangeCode, folderFor, GoogleDrive, markdownToHtml, MIME, rowsToCsv, saveGoogle, saveToDrive, seal, unseal,
} from "../src/storage/google.js";
import { GoogleBackend, Storage } from "../src/storage/storage.js";
import { saveParentSettings, loadParentSettings } from "../src/settings.js";

const KEY = "a".repeat(64);
process.env.KITH_SECRET_KEY = KEY;
config.google.clientId = "client";
config.google.clientSecret = "secret";

interface Call { url: string; method: string; body: string }
function fakeGoogle() {
  const calls: Call[] = [];
  let n = 0;
  const f = (async (url: string, init: RequestInit = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? init.body : init.body instanceof URLSearchParams ? init.body.toString() : "";
    calls.push({ url, method, body });
    if (url.includes("oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "at", expires_in: 3600 }), { status: 200 });
    if (url.includes("/permissions")) return new Response(JSON.stringify({ id: "perm" }), { status: 200 });
    if (url.includes(":batchUpdate")) return new Response("{}", { status: 200 });
    n++;
    return new Response(JSON.stringify({ id: `id${n}`, webViewLink: `https://docs.google.com/x/id${n}` }), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

let db: DB;
beforeEach(() => {
  db = openDb(":memory:");
  saveGoogle(db, { email: "kid@gmail.com", refresh: seal("rt"), connectedAt: 0, folders: {}, sharedWith: "" });
});

describe("tokens", () => {
  it("are stored encrypted and come back intact", () => {
    const s = seal("1//refresh-token");
    expect(s).not.toContain("refresh");
    expect(unseal(s)).toBe("1//refresh-token");
  });
  it("can't be read with another key", () => {
    expect(() => unseal(seal("x"), Buffer.alloc(32, 1))).toThrow();
  });
});

describe("connecting", () => {
  const idToken = (email: string) => `x.${Buffer.from(JSON.stringify({ email, email_verified: true })).toString("base64url")}.y`;
  const respond = (body: object) => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
  it("accepts drive.file only", async () => {
    const r = await exchangeCode("c", "v", respond({ refresh_token: "rt", access_token: "at", id_token: idToken("kid@gmail.com"), scope: "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/drive.file" }));
    expect(r.email).toBe("kid@gmail.com");
  });
  it("refuses more access than it asked for", async () => {
    await expect(exchangeCode("c", "v", respond({ refresh_token: "rt", access_token: "at", id_token: idToken("kid@gmail.com"), scope: "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive" }))).rejects.toThrow(/more than Kith asked/);
  });
  it("refuses the wrong account when one is configured", async () => {
    config.google.expectedEmail = "kid@gmail.com";
    await expect(exchangeCode("c", "v", respond({ refresh_token: "rt", access_token: "at", id_token: idToken("mum@gmail.com"), scope: "https://www.googleapis.com/auth/drive.file" }))).rejects.toThrow(/different Google account/);
    await expect(exchangeCode("c", "v", respond({ refresh_token: "rt", access_token: "at", id_token: idToken("mum@gmail.com"), scope: "https://www.googleapis.com/auth/drive.file" }))).rejects.not.toThrow(/@/);
    config.google.expectedEmail = "";
  });
  it("revokes a refused sign-in's token before dropping it (wrong account, or extra access)", async () => {
    const calls: string[] = [];
    const recording = (body: object) => (async (url: string | URL) => { calls.push(String(url)); return new Response(JSON.stringify(body), { status: 200 }); }) as unknown as typeof fetch;
    config.google.expectedEmail = "kid@gmail.com";
    await expect(exchangeCode("c", "v", recording({ refresh_token: "rt-wrong", access_token: "at", id_token: idToken("mum@gmail.com"), scope: "https://www.googleapis.com/auth/drive.file" }))).rejects.toThrow(/different Google account/);
    config.google.expectedEmail = "";
    await expect(exchangeCode("c", "v", recording({ refresh_token: "rt-extra", access_token: "at", id_token: idToken("kid@gmail.com"), scope: "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive" }))).rejects.toThrow(/more than Kith asked/);
    const revoked = calls.filter((u) => u.startsWith("https://oauth2.googleapis.com/revoke"));
    expect(revoked.map((u) => new URL(u).searchParams.get("token"))).toEqual(["rt-wrong", "rt-extra"]);
    // An accepted one isn't revoked.
    calls.length = 0;
    await exchangeCode("c", "v", recording({ refresh_token: "rt-ok", access_token: "at", id_token: idToken("kid@gmail.com"), scope: "https://www.googleapis.com/auth/drive.file" }));
    expect(calls.some((u) => u.includes("revoke"))).toBe(false);
  });
  it("needs offline access", async () => {
    await expect(exchangeCode("c", "v", respond({ access_token: "at", scope: "https://www.googleapis.com/auth/drive.file" }))).rejects.toThrow(/offline/);
  });
});

describe("Drive", () => {
  it("makes the Kith folder and subfolders once, then puts stories in Stories as Google Docs", async () => {
    const { f, calls } = fakeGoogle();
    const d = new GoogleDrive(db, () => undefined, f);
    const a = await saveToDrive(d, { kind: "story", title: "Dragon", format: "md", content: "# Dragon\n\nOnce upon a time", version: 1 });
    await saveToDrive(d, { kind: "story", title: "Dragon", format: "md", content: "# Dragon\n\nMore", version: 2 });
    const folders = calls.filter((c) => c.body.includes(MIME.folder));
    expect(folders.map((c) => JSON.parse(c.body).name)).toEqual(["Kith", "Stories"]);
    const uploads = calls.filter((c) => c.url.includes("/upload/"));
    expect(uploads).toHaveLength(2);
    expect(uploads[0].body).toContain(MIME.doc);
    expect(uploads[0].body).toContain('"name":"Dragon"');
    expect(uploads[1].body).toContain('"name":"Dragon (v2)"'); // a new file alongside, never an overwrite
    expect(a.url).toMatch(/^https:\/\/docs\.google\.com/);
  });

  it("never deletes, patches or overwrites", async () => {
    const { f, calls } = fakeGoogle();
    const d = new GoogleDrive(db, () => undefined, f);
    await saveToDrive(d, { kind: "game", title: "Fraction quest", format: "html", content: "<p>hi</p>", version: 1 });
    await saveToDrive(d, { kind: "flashcards", title: "Cells", format: "html", content: "<p>x</p>", version: 1, rows: [["Nucleus", "Holds DNA"]] });
    await saveToDrive(d, { kind: "slides", title: "Victorians", format: "html", content: "<p>x</p>", version: 1, slides: [{ title: "1851", body: "The Great Exhibition" }] });
    expect(calls.every((c) => ["GET", "POST"].includes(c.method))).toBe(true);
    expect(calls.some((c) => /\/files\/[^/?]+$/.test(c.url) && c.method !== "GET")).toBe(false);
  });

  it("makes flashcards a Sheet too, and slides a Slides file in Presentations", async () => {
    const { f, calls } = fakeGoogle();
    const d = new GoogleDrive(db, () => undefined, f);
    const fc = await saveToDrive(d, { kind: "flashcards", title: "Cells", format: "html", content: "<p>x</p>", version: 1, rows: [["Nucleus", "Holds DNA"]] });
    expect(fc.extra).toBeTruthy();
    expect(calls.some((c) => c.body.includes(MIME.sheet) && c.body.includes("Nucleus,Holds DNA"))).toBe(true);
    await saveToDrive(d, { kind: "slides", title: "Victorians", format: "html", content: "", version: 1, slides: [{ title: "1851", body: "Exhibition" }] });
    const pres = calls.find((c) => c.body.includes(MIME.slides))!;
    expect(JSON.parse(pres.body).parents).toHaveLength(1);
  });

  it("only ever shares the Kith folder, view-only, with the parent", async () => {
    const { f, calls } = fakeGoogle();
    const d = new GoogleDrive(db, () => undefined, f);
    await d.shareWithParent("mum@gmail.com");
    await d.shareWithParent("mum@gmail.com"); // once
    const perms = calls.filter((c) => c.url.includes("/permissions"));
    expect(perms).toHaveLength(1);
    expect(JSON.parse(perms[0].body)).toEqual({ role: "reader", type: "user", emailAddress: "mum@gmail.com" });
    expect(perms[0].url).toContain("sendNotificationEmail=false");
  });

  it("logs every write", async () => {
    const { f } = fakeGoogle();
    const log: string[] = [];
    const d = new GoogleDrive(db, (tool, args) => log.push(`${tool}:${args}`), f);
    await saveToDrive(d, { kind: "story", title: "Dragon", format: "md", content: "x", version: 1 });
    expect(log).toEqual(["create_folder:Kith", "create_folder:Stories", "create_file:Stories/Dragon"]);
  });
});

describe("storage backends", () => {
  it("the desk is enough: Google is only used when connected and switched on by the parent", async () => {
    const { f, calls } = fakeGoogle();
    const storage = new Storage(db, [new GoogleBackend(db, f)]);
    expect(await storage.mirror("dragon-1", { kind: "story", title: "Dragon", format: "md", content: "x", version: 1 })).toEqual([]);
    expect(calls).toHaveLength(0);
    const s = loadParentSettings(db);
    s.connections.find((c) => c.kind === "google-drive")!.enabled = true;
    saveParentSettings(db, s);
    const links = await storage.mirror("dragon-1", { kind: "story", title: "Dragon", format: "md", content: "x", version: 1 });
    expect(links).toHaveLength(1);
    expect(storage.links("dragon-1")[0].url).toMatch(/docs\.google\.com/);
  });
});

describe("helpers", () => {
  it("folders by kind", () => {
    expect(folderFor("story")).toBe("Stories");
    expect(folderFor("flashcards")).toBe("Revision");
    expect(folderFor("slides")).toBe("Presentations");
    expect(folderFor("game")).toBe("Games & artifacts");
    expect(folderFor("sketch", [3])).toBe("OCs");
  });
  it("escapes HTML when turning Markdown into a Doc", () => {
    expect(markdownToHtml("# Hi <script>\n\n**bold**")).toContain("<h1>Hi &lt;script&gt;</h1>");
  });
  it("writes safe CSV", () => {
    expect(rowsToCsv([["a,b", 'say "hi"']])).toBe('"a,b","say ""hi"""');
  });
});
