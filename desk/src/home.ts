// The desk browser's own homepage (new tabs open here). It's drawn inside the desk, so it needs
// nothing from the internet: a search box (Bing with SafeSearch strict, through the same
// block list) and the family's favourite sites as tiles.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const PRETTY: Record<string, string> = {
  "en.wikipedia.org": "Wikipedia", "simple.wikipedia.org": "Simple Wikipedia", "www.bbc.co.uk/bitesize": "BBC Bitesize",
  "www.thenational.academy": "Oak National Academy", "www.natgeokids.com": "Nat Geo Kids", "www.nhm.ac.uk": "Natural History Museum",
  "www.tate.org.uk": "Tate", "www.metmuseum.org": "The Met", "www.corbettmaths.com": "Corbettmaths",
};
const COLOURS = ["#D9A3E0", "#F59646", "#7FD8A4", "#9CC2E8", "#F2C14E", "#E8879C"];

export function siteName(entry: string): string {
  const e = entry.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (PRETTY[e]) return PRETTY[e];
  const host = e.split("/")[0].replace(/^www\./, "");
  const base = host.split(".")[0];
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export function homePage(o: { name: string; sites: string[]; mode?: "blocklist" | "safelist"; now?: Date }): string {
  const now = o.now ?? new Date();
  const h = now.getHours();
  const hello = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const tiles = o.sites.slice(0, 12).map((s, i) => {
    const url = `https://${s.trim().replace(/^https?:\/\//, "")}`;
    const n = siteName(s);
    return `<a class="tile" href="${esc(url)}"><span class="dot" style="background:${COLOURS[i % COLOURS.length]}">${esc(n.charAt(0))}</span><span>${esc(n)}</span></a>`;
  }).join("");
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>Home</title>
<style>
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{font-family:ui-rounded,"Nunito","Segoe UI",system-ui,sans-serif;color:#fff;
background:radial-gradient(1200px 600px at 20% 0%,#5b3a78 0%,transparent 60%),radial-gradient(900px 500px at 100% 100%,#8a4a5f 0%,transparent 55%),#2a1d3a;
display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px;padding:40px}
.hello{font-size:15px;letter-spacing:.08em;text-transform:uppercase;opacity:.7;font-weight:800}
h1{margin:0;font-size:44px;font-weight:800;letter-spacing:-.01em}
h1 b{color:#D9A3E0}
form{display:flex;width:min(640px,90vw);background:#fff;border-radius:999px;padding:6px;box-shadow:0 18px 40px rgba(0,0,0,.35)}
input{flex:1;border:0;outline:0;font:inherit;font-size:19px;padding:12px 20px;border-radius:999px;color:#2a1d3a;background:transparent}
button{border:0;border-radius:999px;background:#2a1d3a;color:#fff;font:inherit;font-weight:800;font-size:16px;padding:0 26px;cursor:pointer}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:12px;width:min(760px,92vw)}
.tile{display:flex;flex-direction:column;align-items:center;gap:8px;padding:16px 10px;border-radius:16px;background:rgba(255,255,255,.08);color:#fff;text-decoration:none;font-weight:700;font-size:14px;text-align:center}
.tile:hover{background:rgba(255,255,255,.16)}
.dot{width:44px;height:44px;border-radius:14px;display:grid;place-items:center;color:#2a1d3a;font-weight:900;font-size:20px}
.note{font-size:13px;opacity:.6;display:flex;gap:8px;align-items:center}
</style></head><body>
<div style="text-align:center"><div class="hello">${hello}</div><h1><b>${esc(o.name)}</b>’s browser</h1></div>
<form action="https://www.bing.com/search" method="get" role="search">
<input name="q" placeholder="Search the web" aria-label="Search the web" autocomplete="off" autofocus>
<input type="hidden" name="adlt" value="strict"><input type="hidden" name="setlang" value="en-GB"><button type="submit">Search</button></form>
${tiles ? `<div class="tiles">${tiles}</div>` : ""}
<div class="note"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3.5l7 2.8v5.2c0 4.3-2.9 7.6-7 9-4.1-1.4-7-4.7-7-9V6.3l7-2.8Z"/></svg>
${o.mode === "safelist" ? "Only the family’s favourite sites open here." : "SafeSearch is on, and the family’s block list keeps unsuitable sites out."}</div>
</body></html>`;
}
