import { describe, expect, it } from "vitest";
import { pageAllowed, resourceAllowed } from "../src/rules.js";

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
