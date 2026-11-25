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
  it("is read-only and never runs scripts", () => {
    expect(resourceAllowed("https://en.wikipedia.org/w/index.php", "document", "POST", rules)).toBe(false);
    expect(resourceAllowed("https://en.wikipedia.org/x.js", "script", "GET", rules)).toBe(false);
    expect(resourceAllowed("https://en.wikipedia.org/api", "fetch", "GET", rules)).toBe(false);
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
    expect(resourceAllowed("https://cdn.example.net/a.js", "script", "GET", r)).toBe(false);
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
