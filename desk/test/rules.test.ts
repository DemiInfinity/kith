import { describe, expect, it } from "vitest";
import { looksLikeRobotCheck, pageAllowed, resourceAllowed } from "../src/rules.js";

const rules = { sites: ["en.wikipedia.org", "www.bbc.co.uk/bitesize"], assetHosts: ["upload.wikimedia.org", "static.files.bbci.co.uk"] };
describe("desk browser rules", () => {
  it("allows safe-listed pages, with path prefixes", () => {
    expect(pageAllowed("https://en.wikipedia.org/wiki/Cell_(biology)", rules)).toBe(true);
    expect(pageAllowed("https://www.bbc.co.uk/bitesize/guides/zcx", rules)).toBe(true);
    expect(pageAllowed("https://www.bbc.co.uk/news", rules)).toBe(false);
  });
  it("https only, no credentials in URLs, nothing off the list", () => {
    expect(pageAllowed("http://en.wikipedia.org/wiki/X", rules)).toBe(false);
    expect(pageAllowed("https://user:pw@en.wikipedia.org/", rules)).toBe(false);
    expect(pageAllowed("https://example.com/", rules)).toBe(false);
  });
  it("loads a listed site's own scripts and data, nothing from elsewhere", () => {
    expect(resourceAllowed("https://en.wikipedia.org/x.js", "script", "GET", rules)).toBe(true);
    expect(resourceAllowed("https://tracker.example/x.js", "script", "GET", rules)).toBe(false);
    expect(resourceAllowed("http://en.wikipedia.org/x.js", "script", "GET", rules)).toBe(false);
  });
  it("lets images and styles come from listed asset hosts", () => {
    expect(resourceAllowed("https://upload.wikimedia.org/a.png", "image", "GET", rules)).toBe(true);
    expect(resourceAllowed("https://static.files.bbci.co.uk/a.css", "stylesheet", "GET", rules)).toBe(true);
    expect(resourceAllowed("https://tracker.example/p.gif", "image", "GET", rules)).toBe(false);
  });
});

describe("the whole web, minus the block list", () => {
  const r = { mode: "blocklist" as const, sites: ["en.wikipedia.org"], assetHosts: [], blocked: ["bet365.com", "reddit.com"], words: ["casino", "porn"] };
  it("opens ordinary https sites and their images", () => {
    expect(pageAllowed("https://www.example.org/x", r)).toBe(true);
    expect(resourceAllowed("https://cdn.example.net/a.png", "image", "GET", r)).toBe(true);
    expect(resourceAllowed("https://cdn.example.net/a.js", "script", "GET", r)).toBe(true);
    expect(resourceAllowed("https://ads.casino-partner.example/a.js", "script", "GET", r)).toBe(false);
    expect(resourceAllowed("wss://live.example.net/socket", "websocket", "GET", r)).toBe(true);
  });
  it("refuses blocked sites, blocked words, plain http and internal names", () => {
    expect(pageAllowed("https://www.reddit.com/r/x", r)).toBe(false);
    expect(pageAllowed("https://mega-casino.example/", r)).toBe(false);
    expect(pageAllowed("http://www.example.org/", r)).toBe(false);
    expect(pageAllowed("https://192.168.1.50/", r)).toBe(false);
    expect(pageAllowed("https://homeassistant.local/", r)).toBe(false);
  });
});

describe("robot checks", () => {
  it("are spotted, so Pip stops", () => {
    expect(looksLikeRobotCheck("Just a moment...", "Checking your browser before accessing")).toBe(true);
    expect(looksLikeRobotCheck("Shop", "lots of text", ["https://www.google.com/recaptcha/api2/anchor"])).toBe(true);
    expect(looksLikeRobotCheck("Cell (biology)", "The cell is the basic unit of life. ".repeat(200))).toBe(false);
  });
});

describe("sign-ins", () => {
  it("anything sent with a password in it is spotted", async () => {
    const { looksLikeSignIn } = await import("../src/browser.js");
    expect(looksLikeSignIn("user=sam&password=hunter2")).toBe(true);
    expect(looksLikeSignIn('{"email":"a@b.c","pass":"x"}')).toBe(true);
    expect(looksLikeSignIn("q=cells&lang=en")).toBe(false);
    expect(looksLikeSignIn(null)).toBe(false);
  });
});
