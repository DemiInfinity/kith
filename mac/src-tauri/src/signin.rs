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
// 3. GET <server>/auth/login?handoff=<id>&json=1 → the provider's address, opened in her browser.
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
    }
    let body = serde_json::json!({ "app": hint }).to_string();
    let resp = agent.post(&format!("{server}/auth/handoff/start")).header("X-Kith", "1").header("Content-Type", "application/json").send(&body);
    let Ok(mut r) = resp else { return Started::Failed(None) };
    let status = r.status().as_u16();
    let text = r.body_mut().read_to_string().unwrap_or_default();
    match status {
        200 => match serde_json::from_str::<Out>(&text) {
            Ok(o) if is_id(&o.id) && !o.secret.is_empty() => Started::Handoff(Handoff { id: o.id, secret: Some(o.secret) }),
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

/// Where the provider's sign-in page is for this handoff: `{url}` from ?json=1, or the server's
/// redirect (an older server), without following it. `Err` carries the server's words, if any.
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
    format!(
        r#"(() => {{
  const id = {id:?};
  const headers = {headers};
  if (window.__kithSignin) window.__kithSignin.stop = true;
  const run = {{ stop: false }};
  window.__kithSignin = run;
  document.getElementById("kith-signin")?.remove();
  const box = document.createElement("div");
  box.id = "kith-signin";
  box.setAttribute("role", "status");
  box.style.cssText = "position:fixed;inset:0;z-index:99999;display:grid;place-items:center;background:rgba(28,18,25,.92);color:#fbeaf6;font:16px/1.45 Nunito,system-ui,sans-serif;text-align:center";
  box.innerHTML = '<div style="max-width:420px;display:flex;flex-direction:column;gap:12px;align-items:center"><b style="font:600 26px/1.15 Fraunces,Georgia,serif">Finish signing in in your browser</b><span id="kith-signin-msg" style="color:#c9a9d1">Use your passkey there. Kith will carry on here by itself.</span><button id="kith-signin-cancel" style="font:inherit;font-weight:700;padding:9px 18px;border-radius:999px;border:1px solid #4a3046;background:transparent;color:#e4b8ec;cursor:pointer">Cancel</button></div>';
  document.body.appendChild(box);
  const msg = (t) => {{ const m = document.getElementById("kith-signin-msg"); if (m) m.textContent = t; }};
  document.getElementById("kith-signin-cancel").onclick = () => {{ run.stop = true; box.remove(); }};
  const until = Date.now() + 150000;
  (async () => {{
    while (Date.now() < until && !run.stop) {{
      await new Promise((r) => setTimeout(r, 1500));
      if (run.stop) return;
      try {{
        const r = await fetch("/auth/handoff/" + id, {{ credentials: "same-origin", cache: "no-store", headers }});
        const j = await r.json().catch(() => ({{}}));
        if (r.ok && j.ok) {{ location.href = j.redirect || "/"; return; }}
        if ((r.ok && j.pending) || r.status === 429) continue;
        msg(j.error === "not-allowed" ? "That account isn't set up for Kith. Ask the grown-up who runs it." : r.status === 410 ? "That took too long. Close this and try again." : "Sign-in didn't finish. Close this and try again.");
        return;
      }} catch (e) {{ /* offline for a moment */ }}
    }}
    if (!run.stop) msg("That took too long. Close this and try again.");
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
        let (handoff, login) = match start_handoff(&agent, &server, hint) {
            Started::Handoff(h) => {
                let login = format!("{server}/auth/login?handoff={}&json=1", h.id);
                (h, login)
            }
            Started::Old => {
                let Some(id) = random_id() else { return };
                let login = format!("{server}/auth/login?handoff={id}&app={hint}");
                (Handoff { id, secret: None }, login)
            }
            Started::Failed(words) => {
                eval_on_server(&app, &server, &failure_script(words.as_deref()));
                return;
            }
        };
        let provider = match provider_url(&agent, &server, &login) {
            Ok(p) => p,
            Err(words) => {
                // Sign-in isn't set up on this server, or it can't be reached.
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
        let _ = app.opener().open_url(provider, None::<&str>);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_secret_goes_in_a_header_and_is_quoted_safely() {
        let h = Handoff { id: "a".repeat(43), secret: Some("s\"; alert(1); //".into()) };
        let js = page_script(&h);
        assert!(js.contains(r#"const headers = { "X-Kith-Handoff-Secret": "s\"; alert(1); //" };"#), "{js}");
        assert!(!js.contains("/auth/handoff/\" + id + \"?"), "the secret never goes in the URL");
        let old = page_script(&Handoff { id: "a".repeat(43), secret: None });
        assert!(old.contains("const headers = {};"));
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
