// Signing in from the Mac app.
//
// Pocket ID signs in with passkeys, and macOS only lets passkeys run in a real browser (or an app
// Apple has approved for that site). Loading the provider in Kith's own window also gets handed to
// whatever app claims that address, so it can open in a separate window. So the app uses the
// server's one-time handoff (server/src/auth.ts):
//
// 1. "Sign in" in the window (a navigation to <server>/auth/login) is stopped here.
// 2. The app starts a handoff: POST <server>/auth/handoff/start {app} → {id, secret}. The id goes
//    in URLs; the secret never does (only in a header), so an id seen in a log or the browser's
//    history isn't enough to collect the session.
// 3. <server>/auth/login?handoff=<id>&app=<hint> opens in her browser (once, within 15 minutes),
//    which sends her on to the provider. After her passkey the browser asks "Finish signing in?"
//    with a 4-digit code; the window shows the same code, big, and nothing is handed over until
//    she taps Yes. No → the poll answers 403 "cancelled", and the window offers Try again.
// 4. The Kith page polls <server>/auth/handoff/<id> with the X-Kith-Handoff-Secret header (a small
//    script added to the page, only while the window shows the server itself). When she's signed
//    in, the server hands the session over once, the page moves on and Kith comes back to the front.
//
// A server from before step 2 (it answers 404 there) gets the older handoff: the app's own random
// id, GET /auth/login?handoff=<id>&app=<hint>, and polling without a secret.

use std::io::Read;
use tauri::{AppHandle, Manager, Url};
use tauri_plugin_opener::OpenerExt;

fn random_id() -> Option<String> {
    let mut b = [0u8; 32];
    std::fs::File::open("/dev/urandom").ok()?.read_exact(&mut b).ok()?;
    Some(base64url(&b))
}

fn base64url(bytes: &[u8]) -> String {
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::new();
    for c in bytes.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        let len = c.len() + 1;
        for i in 0..len {
            out.push(A[(n >> (18 - 6 * i) & 63) as usize] as char);
        }
    }
    out
}

/// A handoff the server has started: its id, and the secret that goes with every poll (`None` for a
/// server from before secrets).
struct Handoff {
    id: String,
    secret: Option<String>,
    /// A short code the sign-in page may ask her to match, if the server gives one.
    code: Option<String>,
}

enum Started {
    Handoff(Handoff),
    /// The server has no /auth/handoff/start yet.
    Old,
    /// Couldn't be started (offline, sign-in not set up): the server's words, if any.
    Failed(Option<String>),
}

fn error_of(body: &str) -> Option<String> {
    #[derive(serde::Deserialize)]
    struct E {
        error: Option<String>,
    }
    serde_json::from_str::<E>(body).ok().and_then(|e| e.error).map(|e| crate::eventkit::clip(&e, 200))
}

fn start_handoff(agent: &ureq::Agent, server: &str, hint: &str) -> Started {
    #[derive(serde::Deserialize)]
    struct Out {
        id: String,
        secret: String,
        #[serde(default)]
        code: Option<String>,
    }
    // device: the browser's "Finish signing in?" page says "your Mac app".
    let body = serde_json::json!({ "app": hint, "device": "mac" }).to_string();
    let resp = agent.post(&format!("{server}/auth/handoff/start")).header("X-Kith", "1").header("Content-Type", "application/json").send(&body);
    let Ok(mut r) = resp else { return Started::Failed(None) };
    let status = r.status().as_u16();
    let text = r.body_mut().read_to_string().unwrap_or_default();
    match status {
        200 => match serde_json::from_str::<Out>(&text) {
            Ok(o) if is_id(&o.id) && !o.secret.is_empty() => {
                // Shown on the page as text: keep it short and plain.
                let code = o.code.map(|c| crate::eventkit::clip(c.trim(), 16)).filter(|c| !c.is_empty() && c.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == ' '));
                Started::Handoff(Handoff { id: o.id, secret: Some(o.secret), code })
            }
            _ => Started::Failed(None),
        },
        404 => Started::Old,
        _ => Started::Failed(error_of(&text)),
    }
}

/// The handoff ids the server accepts: 32 random bytes, base64url.
fn is_id(id: &str) -> bool {
    id.len() == 43 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// Where the provider's sign-in page is for an older server's handoff: its redirect (or `{url}`),
/// without following it. `Err` carries the server's words, if any.
fn provider_url(agent: &ureq::Agent, server: &str, login: &str) -> Result<String, Option<String>> {
    let mut resp = agent.get(login).call().map_err(|_| None)?;
    let status = resp.status();
    let loc = if status.is_redirection() {
        resp.headers().get("location").and_then(|l| l.to_str().ok()).map(String::from)
    } else {
        let text = resp.body_mut().read_to_string().unwrap_or_default();
        if !status.is_success() {
            return Err(error_of(&text));
        }
        #[derive(serde::Deserialize)]
        struct Out {
            url: String,
        }
        serde_json::from_str::<Out>(&text).ok().map(|o| o.url)
    };
    let url = Url::parse(server).ok().and_then(|base| base.join(&loc?).ok()).ok_or(None)?;
    if matches!(url.scheme(), "https" | "http") { Ok(url.to_string()) } else { Err(None) }
}

/// The script added to the Kith page: a note on top, and the polling.
fn page_script(h: &Handoff) -> String {
    let id = &h.id;
    // JSON strings are valid JavaScript strings.
    let headers = match &h.secret {
        Some(secret) => format!("{{ \"X-Kith-Handoff-Secret\": {} }}", serde_json::to_string(secret).unwrap_or_default()),
        None => "{}".to_string(),
    };
    let code = serde_json::to_string(&h.code).unwrap_or_else(|_| "null".into());
    format!(
        r#"(() => {{
  const id = {id:?};
  const headers = {headers};
  const code = {code};
  if (window.__kithSignin) window.__kithSignin.stop = true;
  const run = {{ stop: false }};
  window.__kithSignin = run;
  document.getElementById("kith-signin")?.remove();
  const el = (tag, css, text) => {{ const e = document.createElement(tag); if (css) e.style.cssText = css; if (text) e.textContent = text; return e; }};
  const button = (text, primary) => el("button", "font:inherit;font-weight:800;padding:10px 20px;border-radius:999px;cursor:pointer;" + (primary ? "border:none;background:#f59646;color:#2a170c" : "border:1px solid #4a3046;background:transparent;color:#e4b8ec"), text);
  const box = el("div", "position:fixed;inset:0;z-index:99999;display:grid;place-items:center;background:rgba(28,18,25,.94);color:#fbeaf6;font:16px/1.45 Nunito,system-ui,sans-serif;text-align:center");
  box.id = "kith-signin";
  box.setAttribute("role", "status");
  const inner = el("div", "max-width:440px;display:flex;flex-direction:column;gap:12px;align-items:center;padding:0 16px");
  const title = el("b", "font:600 26px/1.15 Fraunces,Georgia,serif", "Finish signing in in your browser");
  const big = el("div", "font:800 52px/1.1 ui-rounded,system-ui,sans-serif;letter-spacing:.18em;padding:6px 18px 6px calc(18px + .18em);border-radius:16px;background:#2a1c27;border:2px solid #4a3046;color:#fbeaf6", code || "");
  big.setAttribute("aria-label", code ? "Code " + code.split("").join(" ") : "");
  const words = el("span", "color:#c9a9d1", code ? "Use your passkey there. Then check your browser shows " + code + ", and tap Yes." : "Use your passkey there. Kith will carry on here by itself.");
  const buttons = el("div", "display:flex;gap:10px;flex-wrap:wrap;justify-content:center");
  const again = button("Try again", true);
  const close = button("Cancel", false);
  again.hidden = true;
  buttons.append(again, close);
  inner.append(title);
  if (code) inner.append(big);
  inner.append(words, buttons);
  box.append(inner);
  document.body.appendChild(box);
  // Something went wrong: say so kindly and offer to start again (the app catches /auth/login and
  // starts a fresh handoff in the browser).
  const stopped = (heading, text) => {{
    title.textContent = heading;
    words.textContent = text;
    big.remove();
    box.setAttribute("role", "alert");
    again.hidden = false;
    close.textContent = "Close";
  }};
  again.onclick = () => {{ run.stop = true; box.remove(); location.href = "/auth/login"; }};
  close.onclick = () => {{ run.stop = true; box.remove(); }};
  // The browser waits for her passkey and then her Yes, so give it as long as the handoff lasts.
  const until = Date.now() + 10 * 60000;
  (async () => {{
    while (Date.now() < until && !run.stop) {{
      await new Promise((r) => setTimeout(r, 1500));
      if (run.stop) return;
      try {{
        const r = await fetch("/auth/handoff/" + id, {{ credentials: "same-origin", cache: "no-store", headers }});
        const j = await r.json().catch(() => ({{}}));
        if (r.ok && j.ok) {{ location.href = j.redirect || "/"; return; }}
        if ((r.ok && j.pending) || r.status === 429) continue;
        if (j.error === "cancelled") stopped("Sign-in cancelled", "No problem: \u201cNo\u201d was pressed in the browser, so nothing happened. If that was you and you meant Yes, try again.");
        else if (j.error === "not-allowed") stopped("Not set up for Kith", "That account isn't set up for Kith. Ask the grown-up who runs it.");
        else if (r.status === 410) stopped("That took a while", "The sign-in timed out. You can start again whenever you're ready.");
        else stopped("Sign-in didn't finish", "Something went wrong on the way back. Try again in a moment.");
        return;
      }} catch (e) {{ /* offline for a moment */ }}
    }}
    if (!run.stop) stopped("That took a while", "The sign-in timed out. You can start again whenever you're ready.");
  }})();
}})();"#
    )
}

/// A short note on Kith's page when sign-in can't start (in the server's words where it gave some).
fn failure_script(words: Option<&str>) -> String {
    let text = words.unwrap_or("Couldn't start signing in. Check you're online, then try again.");
    let text = serde_json::to_string(text).unwrap_or_default();
    format!(
        r#"(() => {{
  document.getElementById("kith-signin")?.remove();
  const box = document.createElement("div");
  box.id = "kith-signin";
  box.setAttribute("role", "alert");
  box.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:99999;max-width:420px;padding:12px 18px;border-radius:14px;background:#2a1c27;border:1px solid #4a3046;color:#fbeaf6;font:15px/1.4 Nunito,system-ui,sans-serif;text-align:center";
  box.textContent = {text};
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 8000);
}})();"#
    )
}

/// Adds `script` to the window, but only while it's showing Kith's own page: never to a page from
/// somewhere else (the script can carry the handoff secret).
fn eval_on_server(app: &AppHandle, server: &str, script: &str) -> bool {
    let Some(w) = app.get_webview_window(crate::MAIN) else { return false };
    if !w.url().is_ok_and(|u| crate::same_origin(&u, server)) {
        return false;
    }
    w.eval(script).is_ok()
}

/// Starts a sign-in in the browser. Called instead of loading <server>/auth/login in the window.
pub fn start(app: &AppHandle, server: String) {
    let app = app.clone();
    std::thread::spawn(move || {
        let hint = crate::who::hint(&app);
        let agent = crate::net::agent();
        let (handoff, open) = match start_handoff(&agent, &server, hint) {
            // The browser goes to Kith's own sign-in address, which sends it on to the provider
            // (and shows the server's words there if sign-in can't start).
            Started::Handoff(h) => {
                let open = format!("{server}/auth/login?handoff={}&app={hint}", h.id);
                (h, open)
            }
            Started::Old => {
                let Some(id) = random_id() else { return };
                let login = format!("{server}/auth/login?handoff={id}&app={hint}");
                match provider_url(&agent, &server, &login) {
                    Ok(p) => (Handoff { id, secret: None, code: None }, p),
                    Err(words) => {
                        // Sign-in isn't set up on this server, or it can't be reached.
                        eval_on_server(&app, &server, &failure_script(words.as_deref()));
                        return;
                    }
                }
            }
            Started::Failed(words) => {
                eval_on_server(&app, &server, &failure_script(words.as_deref()));
                return;
            }
        };
        // If the window has moved on somewhere else meanwhile, don't open the browser either: the
        // handoff would have nothing to come back to.
        if !eval_on_server(&app, &server, &page_script(&handoff)) {
            return;
        }
        crate::mark_handoff(&app);
        let _ = app.opener().open_url(open, None::<&str>);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_secret_goes_in_a_header_and_is_quoted_safely() {
        let h = Handoff { id: "a".repeat(43), secret: Some("s\"; alert(1); //".into()), code: Some("AB-12".into()) };
        let js = page_script(&h);
        assert!(js.contains(r#"const headers = { "X-Kith-Handoff-Secret": "s\"; alert(1); //" };"#), "{js}");
        assert!(!js.contains("/auth/handoff/\" + id + \"?"), "the secret never goes in the URL");
        let old = page_script(&Handoff { id: "a".repeat(43), secret: None, code: None });
        assert!(old.contains("const headers = {};"));
        assert!(js.contains(r#"const code = "AB-12";"#));
        assert!(js.contains(r#"j.error === "cancelled""#) && js.contains("Try again"));
        assert!(old.contains("const code = null;"));
    }

    #[test]
    fn handoff_ids_are_43_base64url_characters() {
        assert!(is_id(&"A-_z".repeat(11)[..43]));
        assert!(!is_id("short"));
        assert!(!is_id(&"a/".repeat(22)[..43]));
    }

    #[test]
    fn base64url_matches_the_standard() {
        assert_eq!(super::base64url(b"f"), "Zg");
        assert_eq!(super::base64url(b"fo"), "Zm8");
        assert_eq!(super::base64url(b"foo"), "Zm9v");
        assert_eq!(super::base64url(&[0xfb, 0xff]), "-_8");
        assert_eq!(super::base64url(&[0u8; 32]).len(), 43);
    }
}
