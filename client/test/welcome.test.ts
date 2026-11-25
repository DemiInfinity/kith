import { existsSync, readFileSync } from "node:fs";
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
    expect(imgs.length).toBe(10);
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
  it("the sitemap has the home page and the four public pages", () => {
    expect(sitemap.match(/<loc>/g)).toHaveLength(5);
    for (const p of ["", "parents", "setup", "terms", "privacy"]) expect(sitemap).toContain(`<loc>https://ai.hearthstream.xyz/${p}</loc>`);
  });
  it("robots.txt allows the public pages", () => {
    for (const p of ["/terms$", "/privacy$", "/setup$", "/parents$"]) expect(robots).toContain(`Allow: ${p}\n`);
  });
});

describe("terms, privacy and the setup guide (real HTML too)", () => {
  const read = (f: string) => readFileSync(resolve(root, f), "utf8");
  const words = (h: string) => h.slice(h.indexOf("<main"), h.indexOf("</main>")).replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
  for (const [file, path] of [["terms.html", "/terms"], ["privacy.html", "/privacy"], ["setup.html", "/setup"], ["parents.html", "/parents"]] as const) {
    it(`${file} has its own title, description and canonical, and one h1`, () => {
      const h = read(file);
      expect(h).toContain(`<link rel="canonical" href="https://ai.hearthstream.xyz${path}" />`);
      expect(h).toMatch(/<title>[^<]+ · Kith<\/title>/);
      const desc = /<meta name="description" content="([^"]+)"/.exec(h)?.[1] ?? "";
      expect(desc.length).toBeGreaterThan(110);
      expect(desc.length).toBeLessThanOrEqual(160);
      expect(h.match(/<h1[\s>]/g)).toHaveLength(1);
      expect(h).toContain('<a href="/terms">Terms of use</a>');
      expect(h).toContain('<a href="/privacy">Privacy</a>');
    });
  }
  it("the terms say who runs a Kith is responsible for it, and aren't legal advice", () => {
    const h = read("terms.html");
    expect(h).toContain("Last updated: 25 November 2026");
    expect(h).toContain('id="t-operator">If you run your own Kith');
    expect(h).toContain("Not legal advice:</b> check with a professional if you run Kith for others.");
    expect(h).toContain("AGPL-3.0");
    expect(words(h)).toBeGreaterThan(600);
  });
  it("the privacy policy covers what's kept, who it's shared with and the operator's own notice", () => {
    const h = read("privacy.html");
    expect(h).toContain("Last updated: 25 November 2026");
    expect(h).toContain("If you run Kith yourself, you're the data controller and need your own privacy notice (you can adapt this one).");
    for (const t of ["30 days", "anthropic.com/legal", "one cookie", "Age Appropriate Design Code"]) expect(h).toContain(t);
    expect(words(h)).toBeGreaterThan(600);
  });
  it("the setup guide has eleven steps, a table of contents, commands and HowTo data", () => {
    const h = read("setup.html");
    expect(h.match(/class="card step"/g)).toHaveLength(11);
    expect(h).toContain('aria-label="Setup steps"');
    expect(h).toContain("./scripts/setup-secrets.sh");
    const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(h)![1]);
    expect(ld["@type"]).toBe("HowTo");
    expect(ld.step).toHaveLength(11);
  });
  it("the welcome page points at the setup guide and carries the operator note", () => {
    expect(html).toContain('<a class="btn ghost" href="/setup">Read the setup guide</a>');
    expect(html).toContain('<li><a href="/setup">Setup guide</a></li>');
    expect(html).toContain("If you set up Kith, you run it");
  });
});

describe("the Kith Parent tour", () => {
  const h = readFileSync(resolve(root, "parents.html"), "utf8");
  it("covers every part, each with a screenshot and words", () => {
    const parts = ["overview", "reports", "summary", "budgets", "notifications", "safeguards", "skills", "connectors", "browser", "languages", "google", "sessions", "mac"];
    for (const id of parts) expect(h).toContain(`id="${id}"`);
    expect(h.match(/class="tour-item/g)).toHaveLength(parts.length);
    const imgs = [...h.matchAll(/<img [^>]+>/g)].map((m) => m[0]);
    for (const i of imgs) { expect(i).toMatch(/ alt="[^"]{20,}"/); expect(i).toMatch(/ width="\d+" height="\d+"/); }
    // Every screenshot it uses exists, as WebP and JPG.
    for (const m of h.matchAll(/\/welcome\/(parent-[a-z-]+)\.webp/g)) {
      expect(existsSync(resolve(root, `public/welcome/${m[1]}.webp`))).toBe(true);
      expect(existsSync(resolve(root, `public/welcome/${m[1]}.jpg`))).toBe(true);
    }
  });
  it("shows an example report and ends with what you never see", () => {
    expect(h).toContain('aria-label="An example report"');
    expect(h).toContain('id="never-h">What you never see');
    expect(h).toContain("Their everyday chats.");
    expect(h).toContain("Their memories.");
  });
  it("is linked from the welcome page", () => {
    expect(html).toContain('<a class="btn primary" href="/parents">See the full tour');
    expect(html).toContain('<li><a href="/parents">For grown-ups</a></li>');
  });
});
