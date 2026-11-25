// Signing in from the Mac app.
//
// Pocket ID signs in with passkeys, and macOS only lets passkeys run in a real browser (or an app
// Apple has approved for that site). Loading the provider in Kith's own window also gets handed to
// whatever app claims that address, so it can open in a separate window. So the app uses the
// server's one-time handoff (server/src/auth.ts):
//
// 1. "Sign in" in the window (a navigation to <server>/auth/login) is stopped here.
// 2. The app asks <server>/auth/login?handoff=<random id> where sign-in starts, and opens that
//    provider page in her browser.
// 3. The Kith page polls <server>/auth/handoff/<id> (a small script added to the page). When she's
//    signed in, the server hands the session over once, the page moves on and Kith comes back
//    to the front.
//
// The id is 32 random bytes, kept in memory; the server stores only its hash and lets it lapse
// after two minutes.

use std::io::Read;
use std::time::Duration;
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

/// Where the provider's sign-in page is for this handoff (the server's redirect), without following it.
fn provider_url(server: &str, id: &str, hint: &str) -> Option<String> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .max_redirects(0)
        .http_status_as_error(false)
        .timeout_global(Some(Duration::from_secs(15)))
        .build()
        .into();
    // app= tells the server which person this app is for; it refuses the other one.
    let login = format!("{server}/auth/login?handoff={id}&app={hint}");
    let resp = agent.get(&login).call().ok()?;
    if !resp.status().is_redirection() {
        return None;
    }
    let loc = resp.headers().get("location")?.to_str().ok()?;
    let url = Url::parse(&login).ok()?.join(loc).ok()?;
    matches!(url.scheme(), "https" | "http").then(|| url.to_string())
}

/// The script added to the Kith page: a note on top, and the polling.
fn page_script(id: &str) -> String {
    format!(
        r#"(() => {{
  const id = {id:?};
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
        const r = await fetch("/auth/handoff/" + id, {{ credentials: "same-origin", cache: "no-store" }});
        const j = await r.json().catch(() => ({{}}));
        if (r.ok && j.ok) {{ location.href = j.redirect || "/"; return; }}
        if ((r.ok && j.pending) || r.status === 429) continue;
        msg(j.error === "not-allowed" ? "That account isn't set up for Kith. Ask the grown-up who runs it." : "Sign-in didn't finish. Close this and try again.");
        return;
      }} catch (e) {{ /* offline for a moment */ }}
    }}
    if (!run.stop) msg("That took too long. Close this and try again.");
  }})();
}})();"#
    )
}

/// Starts a sign-in in the browser. Called instead of loading <server>/auth/login in the window.
pub fn start(app: &AppHandle, server: String) {
    let app = app.clone();
    std::thread::spawn(move || {
        let Some(id) = random_id() else { return };
        let Some(provider) = provider_url(&server, &id, crate::who::hint(&app)) else {
            // Sign-in isn't set up on this server (or it can't be reached): show its own answer.
            if let (Some(w), Ok(u)) = (app.get_webview_window(crate::MAIN), Url::parse(&format!("{server}/auth/login?handoff={id}&app={}", crate::who::hint(&app)))) {
                let _ = w.navigate(u);
            }
            return;
        };
        if let Some(w) = app.get_webview_window(crate::MAIN) {
            let _ = w.eval(page_script(&id));
        }
        crate::mark_handoff(&app);
        let _ = app.opener().open_url(provider, None::<&str>);
    });
}

#[cfg(test)]
mod tests {
    #[test]
    fn base64url_matches_the_standard() {
        assert_eq!(super::base64url(b"f"), "Zg");
        assert_eq!(super::base64url(b"fo"), "Zm8");
        assert_eq!(super::base64url(b"foo"), "Zm9v");
        assert_eq!(super::base64url(&[0xfb, 0xff]), "-_8");
        assert_eq!(super::base64url(&[0u8; 32]).len(), 43);
    }
}
