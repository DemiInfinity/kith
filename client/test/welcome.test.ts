import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const html = readFileSync(resolve(root, "welcome.html"), "utf8");
const app = readFileSync(resolve(root, "index.html"), "utf8");
const robots = readFileSync(resolve(root, "public/robots.txt"), "utf8");
const sitemap = readFileSync(resolve(root, "public/sitemap.xml"), "utf8");

describe("the public welcome page (real HTML for search engines)", () => {
  it("has the title, description, canonical, language and share tags", () => {
    expect(html).toContain('<html lang="en-GB">');
    expect(html).toContain("<title>Kith: an AI companion for kids that lives at home</title>");
    const desc = /<meta name="description" content="([^"]+)"/.exec(html)?.[1] ?? "";
    expect(desc.length).toBeGreaterThan(120);
    expect(desc.length).toBeLessThanOrEqual(160);
    expect(html).toContain('<link rel="canonical" href="https://ai.hearthstream.xyz/" />');
    for (const tag of ['property="og:title"', 'property="og:image" content="https://ai.hearthstream.xyz/welcome/og.png"', 'name="twitter:card" content="summary_large_image"', 'name="theme-color"']) expect(html).toContain(tag);
  });
  it("has valid JSON-LD for the app and the four FAQs", () => {
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    const appLd = blocks.find((b) => b["@type"] === "SoftwareApplication");
    expect(appLd.offers.price).toBe("0");
    expect(appLd.operatingSystem).toBe("Web, macOS, iOS");
    const faq = blocks.find((b) => b["@type"] === "FAQPage");
    expect(faq.mainEntity).toHaveLength(4);
    // The FAQ on the page says the same as the JSON-LD.
    for (const q of faq.mainEntity) expect(html).toContain(`<dt>${q.name}</dt>`);
  });
  it("has one h1, landmarks, and images with alt text and sizes", () => {
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    for (const l of ["<header", "<nav", "<main", "<footer"]) expect(html).toContain(l);
    const imgs = [...html.matchAll(/<img [^>]+>/g)].map((m) => m[0]);
    expect(imgs.length).toBe(8);
    for (const i of imgs) {
      expect(i).toMatch(/ alt="[^"]{10,}"/);
      expect(i).toMatch(/ width="\d+" height="\d+"/);
    }
    // Only the hero phone loads straight away.
    expect(imgs.filter((i) => !i.includes('loading="lazy"'))).toHaveLength(1);
  });
});

describe("what crawlers may see", () => {
  it("the app itself asks not to be indexed", () => {
    expect(app).toContain('<meta name="robots" content="noindex, nofollow" />');
  });
  it("robots.txt allows the home page and its assets, not the API, sign-in or the app", () => {
    expect(robots).toMatch(/^Allow: \/\$$/m);
    expect(robots).toMatch(/^Allow: \/welcome\/$/m);
    for (const p of ["/api/", "/auth/", "/signin", "/settings", "/talk", "/"]) expect(robots).toContain(`Disallow: ${p}\n`);
    expect(robots).toContain("Sitemap: https://ai.hearthstream.xyz/sitemap.xml");
  });
  it("the sitemap has just the home page", () => {
    expect(sitemap.match(/<loc>/g)).toHaveLength(1);
    expect(sitemap).toContain("<loc>https://ai.hearthstream.xyz/</loc>");
  });
});
