import { describe, expect, it } from "vitest";
import { homePage, siteName } from "../src/home.js";

describe("the browser's homepage", () => {
  it("greets, searches with SafeSearch on, and shows favourites", () => {
    const html = homePage({ name: "Pip", sites: ["en.wikipedia.org", "www.bbc.co.uk/bitesize", "www.example.org"], now: new Date(2026, 10, 25, 9) });
    expect(html).toContain("Good morning");
    expect(html).toContain('action="https://www.bing.com/search"');
    expect(html).toContain('name="adlt" value="strict"');
    expect(html).toContain('href="https://www.bbc.co.uk/bitesize"');
    expect(html).toContain(">BBC Bitesize<");
    expect(html).toContain(">Example<");
  });
  it("escapes what goes into it", () => {
    expect(homePage({ name: "<b>x</b>", sites: ['x.example/"><script>'] })).not.toContain("<script>");
    expect(siteName("www.corbettmaths.com")).toBe("Corbettmaths");
  });
});
