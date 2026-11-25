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
use std::time::Duration;
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

fn session_cookie(app: &AppHandle, server: &str) -> Option<String> {
    let w = app.get_webview_window(crate::MAIN)?;
    let cookies = w.cookies_for_url(Url::parse(server).ok()?).ok()?;
    cookies.into_iter().find(|c| c.name() == "kith_sid").map(|c| c.value().to_string())
}

/// `None` if the server couldn't be asked (offline): keep what we had.
fn fetch_role(server: &str, sid: &str) -> Option<Role> {
    let mut r = agent().get(&format!("{server}/api/me")).header("Cookie", &format!("kith_sid={sid}")).call().ok()?;
    match r.status().as_u16() {
        200 => {
            #[derive(Deserialize)]
            struct Me {
                role: String,
            }
            let me: Me = serde_json::from_str(&r.body_mut().read_to_string().ok()?).ok()?;
            Some(if me.role == "parent" { Role::Parent } else { Role::Child })
        }
        401 | 403 => Some(Role::SignedOut),
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
    let mut r = agent().get(&url).header("Cookie", &format!("kith_sid={sid}")).call().ok()?;
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
                let now = match &sid {
                    None => Some(Role::SignedOut),
                    Some(sid) => fetch_role(&server, sid),
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
                if role == Role::Parent {
                    if let Some(sid) = &sid {
                        after = parent_inbox(&app, &server, sid, after).or(after);
                    }
                }
            }
            std::thread::sleep(Duration::from_secs(30));
        }
    });
}
