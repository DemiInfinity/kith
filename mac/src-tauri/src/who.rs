// Who's signed in, and the parent's notifications.
//
// A background thread checks every 30 seconds, whether or not the window is open:
// - the signed-in role, from the server's /api/me with the window's own sign-in cookie (read from
//   the web view's cookie store, kept in memory only, never logged). For the parent, the window and
//   menus say "Kith Parent" and the child-only items (Calendar & Reminders, Call Pip) are off.
// - for the parent, /api/native/parent-inbox: the notifications the server would send the parent
//   by web push. The server applies the parent's choices (which report levels, quiet hours with
//   urgent ones allowed, generic lock-screen text unless summaries are on) and never includes the
//   child's chat; the app just shows what it's given. Until the server has that route it answers
//   404 and the app stays quiet.
//
// The child's notifications stay with the page (client/src/lib/native.ts).

use crate::State;
use serde::Deserialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

static NUDGED: AtomicBool = AtomicBool::new(false);

/// Check again now (a page has just loaded).
pub fn nudge() {
    NUDGED.store(true, Ordering::Relaxed);
}
use tauri::{AppHandle, Manager, Url};
use tauri_plugin_notification::NotificationExt;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Role {
    SignedOut,
    Child,
    Parent,
}

/// Whether this is the "Kith Parent" build (tauri.parent.conf.json): its own name, icon and sign-in.
pub fn parent_edition(app: &AppHandle) -> bool {
    app.config().identifier.ends_with(".parent")
}

/// Which person this app is for: Kith.app is the child's, Kith Parent.app the grown-up's. Sent to the
/// server on sign-in (?app=) and on every request (X-Kith-App, and window.__KITH_APP__ for the page).
pub fn hint(app: &AppHandle) -> &'static str {
    if parent_edition(app) { "parent" } else { "child" }
}

/// What a signed-in person of the wrong role sees here, unless the server says it its own way.
pub fn wrong_words(app: &AppHandle) -> &'static str {
    if parent_edition(app) {
        "This is the grown-ups' app. Kids use Kith."
    } else {
        "This is the kids' Kith. Grown-ups use Kith Parent."
    }
}

/// The other app's bundle id and name.
pub fn other_app(app: &AppHandle) -> (&'static str, &'static str) {
    if parent_edition(app) { ("app.kith.mac", "Kith") } else { ("app.kith.parent", "Kith Parent") }
}

/// The name to show: "Kith Parent" for the parent (or in the parent build), else "Kith".
pub fn name_for(app: &AppHandle, role: Role) -> &'static str {
    if role == Role::Parent || parent_edition(app) {
        "Kith Parent"
    } else {
        "Kith"
    }
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_global(Some(Duration::from_secs(15)))
        .build()
        .into()
}

pub fn session_cookie(app: &AppHandle, server: &str) -> Option<String> {
    let w = app.get_webview_window(crate::MAIN)?;
    let cookies = w.cookies_for_url(Url::parse(server).ok()?).ok()?;
    cookies.into_iter().find(|c| c.name() == "kith_sid").map(|c| c.value().to_string())
}

enum Seen {
    Role(Role),
    /// Signed in as the other person: the server's words, if it gave some.
    WrongApp(Option<String>),
}

/// `None` if the server couldn't be asked (offline): keep what we had.
fn fetch_role(server: &str, sid: &str, hint: &str) -> Option<Seen> {
    let mut r = agent()
        .get(&format!("{server}/api/me"))
        .header("Cookie", &format!("kith_sid={sid}"))
        .header("X-Kith-App", hint)
        .call()
        .ok()?;
    #[derive(Deserialize)]
    struct Me {
        role: Option<String>,
        code: Option<String>,
        error: Option<String>,
    }
    let status = r.status().as_u16();
    let me: Option<Me> = r.body_mut().read_to_string().ok().and_then(|b| serde_json::from_str(&b).ok());
    match status {
        200 => {
            let role = if me?.role.as_deref() == Some("parent") { Role::Parent } else { Role::Child };
            // A server without the app check still mustn't let the wrong person in here.
            let wrong = (hint == "child" && role == Role::Parent) || (hint == "parent" && role == Role::Child);
            Some(if wrong { Seen::WrongApp(None) } else { Seen::Role(role) })
        }
        403 if me.as_ref().and_then(|m| m.code.as_deref()) == Some("wrong-app") => Some(Seen::WrongApp(me.and_then(|m| m.error))),
        401 | 403 => Some(Seen::Role(Role::SignedOut)),
        _ => None,
    }
}

#[derive(Deserialize)]
struct Inbox {
    items: Vec<Item>,
    last: i64,
}

#[derive(Deserialize)]
struct Item {
    title: String,
    body: String,
    #[serde(default)]
    urgent: bool,
}

/// Shows anything new for the parent. Returns where the inbox is up to.
fn parent_inbox(app: &AppHandle, server: &str, sid: &str, after: Option<i64>) -> Option<i64> {
    let url = match after {
        Some(a) => format!("{server}/api/native/parent-inbox?after={a}"),
        None => format!("{server}/api/native/parent-inbox"),
    };
    let mut r = agent().get(&url).header("Cookie", &format!("kith_sid={sid}")).header("X-Kith-App", "parent").call().ok()?;
    if r.status().as_u16() != 200 {
        if std::env::var_os("KITH_DEBUG").is_some() {
            eprintln!("[kith] parent inbox: {}", r.status());
        }
        return after; // not on this server yet (404), or not right now
    }
    let inbox: Inbox = serde_json::from_str(&r.body_mut().read_to_string().ok()?).ok()?;
    for n in inbox.items.iter().take(10) {
        let mut b = app.notification().builder().title(crate::eventkit::clip(&n.title, 80)).body(crate::eventkit::clip(&n.body, 300));
        if n.urgent {
            b = b.sound("Glass");
        }
        let _ = b.show();
    }
    Some(inbox.last)
}

pub fn start(app: AppHandle, state: State) {
    std::thread::spawn(move || {
        let mut role = Role::SignedOut;
        let mut after: Option<i64> = None;
        std::thread::sleep(Duration::from_secs(3));
        loop {
            let server = state.lock().unwrap().config.server.clone();
            if let Some(server) = server {
                let sid = session_cookie(&app, &server);
                let seen = match &sid {
                    None => Some(Seen::Role(Role::SignedOut)),
                    Some(sid) => fetch_role(&server, sid, hint(&app)),
                };
                let now = match seen {
                    Some(Seen::WrongApp(words)) => {
                        // The other person's session: say so, with a way to switch.
                        crate::show_wrong_app(&app, words.unwrap_or_else(|| wrong_words(&app).to_string()));
                        Some(Role::SignedOut)
                    }
                    Some(Seen::Role(r)) => {
                        crate::clear_wrong_app(&app);
                        Some(r)
                    }
                    None => None,
                };
                if let Some(now) = now {
                    if now != role {
                        role = now;
                        if std::env::var_os("KITH_DEBUG").is_some() {
                            eprintln!("[kith] signed in as {role:?}");
                        }
                        after = None; // start from where the inbox is now; don't replay old ones
                        crate::apply_role(&app, role);
                    }
                }
                // Only Kith Parent.app ever asks for the parent's notifications.
                if role == Role::Parent && parent_edition(&app) {
                    if let Some(sid) = &sid {
                        after = parent_inbox(&app, &server, sid, after).or(after);
                    }
                }
            }
            // Every 30 seconds, or sooner when a page has just loaded.
            for _ in 0..30 {
                if NUDGED.swap(false, Ordering::Relaxed) {
                    break;
                }
                std::thread::sleep(Duration::from_secs(1));
            }
        }
    });
}
