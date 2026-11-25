// The start page: checks the server is there, first-run setup, the offline and wrong-app screens.
// A file of its own (not inline) so the page's content security policy can be script-src 'self'.
const { invoke } = window.__TAURI__.core;
const q = new URLSearchParams(location.search);
// Only paths on the server itself ("/chat", not "//elsewhere").
const rawPath = q.get("path") || "/";
const path = rawPath.startsWith("/") && !rawPath.startsWith("//") ? rawPath : "/";
const show = (id) => { for (const s of document.querySelectorAll("section")) s.hidden = s.id !== id; };
let server = null, timer = null, locked = false;

async function reachable(origin) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    // An opaque reply is enough: it means something answered. Kith's public sign-in info is tiny.
    await fetch(origin + "/api/public/signin", { mode: "no-cors", cache: "no-store", credentials: "omit", signal: ctrl.signal });
    return true;
  } catch { return false; } finally { clearTimeout(t); }
}

async function go() {
  clearTimeout(timer);
  show("checking");
  if (await reachable(server)) { location.replace(server + path); return; }
  document.getElementById("offline-server").textContent = server.replace(/^https:\/\//, "");
  show("offline");
  timer = setTimeout(go, 15000);
}

function setup() {
  // A Kith with its server built in has no setup screen to change it.
  if (locked && server) { go(); return; }
  clearTimeout(timer);
  show("setup");
  const input = document.getElementById("server");
  if (server) input.value = server.replace(/^https:\/\//, "");
  input.focus();
}

document.getElementById("retry").onclick = go;
document.getElementById("change").onclick = setup;
window.addEventListener("online", () => { if (!document.getElementById("offline").hidden) go(); });
document.getElementById("form").onsubmit = async (e) => {
  e.preventDefault();
  const err = document.getElementById("err");
  err.textContent = "";
  try { server = await invoke("save_server", { server: document.getElementById("server").value }); go(); }
  catch (x) { err.textContent = String(x); }
};

// Signed in as the other person (Kith is the child's, Kith Parent the grown-up's).
async function wrong() {
  clearTimeout(timer);
  const w = await invoke("wrong_app_info");
  document.getElementById("wrong-title").textContent = document.title === "Kith Parent" ? "This is Kith Parent" : "This is Kith";
  document.getElementById("wrong-words").textContent = w.words || "";
  const other = document.getElementById("other");
  if (w.other) { other.hidden = false; other.textContent = `Open ${w.other}`; other.onclick = () => invoke("open_other_app").catch(() => undefined); }
  show("wrong");
}
document.getElementById("switch").onclick = async () => {
  const err = document.getElementById("wrong-err");
  err.textContent = "";
  try { await invoke("switch_account"); location.replace("index.html"); }
  catch (x) { err.textContent = String(x); }
};

invoke("setup_info").then((s) => {
  server = s.server;
  locked = !!s.locked;
  document.getElementById("change").hidden = locked;
  if (s.appName) document.title = s.appName;
  if (!server || q.get("setup")) setup(); else if (q.get("wrong")) wrong(); else go();
});
