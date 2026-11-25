// Kith for the Mac: your own Kith server in a Mac window, plus the parts of the Mac Pip can use.
//
// The window shows the live web app, so sign-in, cookies, the sandboxed desk frames and every
// future change are the same as on the web. A small bundled start page (../launcher) checks the
// server is there and shows a friendly screen when home can't be reached.
//
// The Mac side (native.rs), offered to the server's own pages only:
// - Mac notifications for Pip's check-ins and reminders; Kith stays in the menu bar when closed;
// - Calendar & Reminders (eventkit.rs), only while she has it switched on in the Kith menu, and
//   only the calendars and lists she ticks there (the menu says exactly what Pip sees); anything
//   Pip adds is confirmed in a native prompt first;
// - documents she picks or drops on the window (files.rs: text only, no photos);
// - ⌃⌥Space from anywhere to call Pip;
// - during a call, a small always-on-top window with Pip when she switches to another app (mini.rs);
// - Pip's voice made on this Mac with Kokoro, fetched the first time it's wanted (voice.rs);
// - whether Apple Music or Spotify is playing, so Pip can listen along (music.rs).
//
// The server: a build with a server baked in (mac/kith.config.json) is locked to it. Kith (the
// child's) has no Change Server at all; Kith Parent can change it after a confirmation. Changing
// it restarts the app, so the old server's pages lose the native commands (a granted capability
// can't be taken back while the app runs).
//
// Where pages may open:
// - the Kith server itself, inside the window;
// - the `signInHosts` in the config, inside the window. Nothing else: signing in itself happens
//   in her browser and is handed back (signin.rs);
// - everything else (Google Drive links, links in chat) in the default browser.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod eventkit;
mod files;
#[cfg(target_arch = "aarch64")]
mod kokoro;
mod mini;
mod music;
mod native;
mod net;
mod notify;
mod signin;
mod updater;
mod voice;
mod who;

use serde::{Deserialize, Serialize};
use std::net::IpAddr;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};
use tauri::ipc::CapabilityBuilder;
use tauri::menu::{AboutMetadata, CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, DragDropEvent, Emitter, Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_window_state::StateFlags;

pub const MAIN: &str = "main";
/// Used when neither a saved address nor a built-in one is set: a Kith server on this Mac
/// (`docker compose up` serves it on port 8787).
const DEFAULT_SERVER: &str = "http://localhost:8787";

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Config {
    #[serde(default)]
    server: Option<String>,
    #[serde(default)]
    sign_in_hosts: Vec<String>,
    /// Kith › Share Calendar & Reminders with Pip. Off until she turns it on (and macOS lets Kith in).
    #[serde(default)]
    share_calendar: bool,
    /// Kith › Choose What Pip Sees: the calendars (EventKit ids) she shares. Absent: all of them.
    #[serde(default)]
    share_calendars: eventkit::Chosen,
    /// …and the reminder lists.
    #[serde(default)]
    share_lists: eventkit::Chosen,
    /// Updates (updater.rs): off unless both are set, in mac/kith.config.json.
    #[serde(default, skip_serializing)]
    update_url: Option<String>,
    #[serde(default, skip_serializing)]
    update_public_key: Option<String>,
}

#[derive(Default)]
pub struct Shell {
    config: Config,
    /// Pages in the desk could try to open lots of links; one browser open per second at most.
    last_external: Option<Instant>,
    /// Recent notifications, and any gathered into an "N more" (notify.rs).
    notes: notify::Notes,
    /// Origins already given the native capability this run.
    granted: Vec<String>,
    /// A sign-in going on in her browser (signin.rs): bring Kith forward when it's done.
    handoff: Option<Instant>,
    /// Signed in as the other person (who.rs): what the wrong-app screen says.
    wrong: Option<String>,
}

pub type State = Arc<Mutex<Shell>>;

/// Locks without panicking: if a thread panicked while holding the lock, carry on with the data
/// as it is (every field is valid on its own) rather than taking the whole app down with it.
pub trait LockExt<T> {
    fn guard(&self) -> MutexGuard<'_, T>;
}
impl<T> LockExt<T> for Mutex<T> {
    fn guard(&self) -> MutexGuard<'_, T> {
        self.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// Menu items that change with who's signed in (see who.rs).
struct Ui {
    call: MenuItem<tauri::Wry>,
    tray_call: MenuItem<tauri::Wry>,
    tray_open: MenuItem<tauri::Wry>,
    tray_quit: MenuItem<tauri::Wry>,
    share: CheckMenuItem<tauri::Wry>,
    /// Kith › Choose What Pip Sees (its items are her calendars and lists).
    choose: Submenu<tauri::Wry>,
    /// Kith › "Pip sees: …", exactly what's shared.
    sees: MenuItem<tauri::Wry>,
}

/// "Kith Parent" for the parent: window title, menu-bar item and its menu. The child-only items
/// (Calendar & Reminders, Call Pip) are off for the parent and in the parent build.
pub fn apply_role(app: &AppHandle, role: who::Role) {
    let a = app.clone();
    let _ = app.run_on_main_thread(move || {
        let name = who::name_for(&a, role);
        let child_things = role != who::Role::Parent && !who::parent_edition(&a);
        if let Some(w) = a.get_webview_window(MAIN) {
            let _ = w.set_title(name);
        }
        if let Some(t) = a.tray_by_id("kith") {
            let _ = t.set_tooltip(Some(name));
        }
        if let Some(ui) = a.try_state::<Ui>() {
            let _ = ui.tray_open.set_text(format!("Open {name}"));
            let _ = ui.tray_quit.set_text(format!("Quit {name}"));
            let _ = ui.call.set_enabled(child_things);
            let _ = ui.tray_call.set_enabled(child_things);
            let _ = ui.share.set_enabled(child_things);
            let _ = ui.choose.set_enabled(child_things);
        }
    });
}

/// The other person's session is in this app: show the start page's wrong-app screen (once).
pub fn show_wrong_app(app: &AppHandle, words: String) {
    let Some(st) = app.try_state::<State>() else { return };
    st.guard().wrong = Some(words);
    // Already showing it? Leave it be; otherwise (first time, or after ⌘R) show it.
    let showing = app
        .get_webview_window(MAIN)
        .and_then(|w| w.url().ok())
        .is_some_and(|u| u.scheme() == "tauri" && u.query().is_some_and(|q| q.contains("wrong=1")));
    if !showing {
        go_via_launcher(app, "?wrong=1");
    }
}

pub fn clear_wrong_app(app: &AppHandle) {
    if let Some(st) = app.try_state::<State>() {
        st.guard().wrong = None;
    }
}

pub fn mark_handoff(app: &AppHandle) {
    if let Some(st) = app.try_state::<State>() {
        st.guard().handoff = Some(Instant::now());
    }
}

fn config_file(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("config.json"))
}

/// mac/kith.config.json, baked in at build time (build.rs). Empty for a build without one.
fn baked() -> Option<Config> {
    option_env!("KITH_DEFAULT_CONFIG").filter(|s| !s.is_empty()).and_then(|s| serde_json::from_str(s).ok())
}

/// The server baked into this build, if any: the build is then locked to it (see the top).
fn baked_server() -> Option<String> {
    baked().and_then(|c| c.server).as_deref().and_then(normalise_server)
}

/// Whether the server can be changed in this app: always without a baked-in server; with one, only
/// in Kith Parent (after a confirmation, see save_server).
fn can_change_server(app: &AppHandle) -> bool {
    baked_server().is_none() || who::parent_edition(app)
}

/// What the app runs with. The saved config (her calendar choices, and a server chosen in the
/// app) over the baked one; a saved file that's unreadable or has no usable server falls back to
/// the baked server, not to this Mac. Kith in a locked build always uses the baked server and its
/// sign-in hosts, whatever the saved file says.
fn load_config(app: &AppHandle) -> Config {
    let saved: Option<Config> = config_file(app).and_then(|p| std::fs::read_to_string(p).ok()).and_then(|s| serde_json::from_str(&s).ok());
    let baked = baked().unwrap_or_default();
    let mut cfg = saved.clone().unwrap_or_else(|| baked.clone());
    cfg.update_url = baked.update_url.clone();
    cfg.update_public_key = baked.update_public_key.clone();
    let baked_server = baked.server.as_deref().and_then(normalise_server);
    let saved_server = saved.as_ref().and_then(|c| c.server.as_deref()).and_then(normalise_server);
    if baked_server.is_some() && !can_change_server(app) {
        cfg.server = baked_server;
        cfg.sign_in_hosts = baked.sign_in_hosts.clone();
    } else {
        cfg.server = saved_server.or(baked_server).or_else(|| normalise_server(DEFAULT_SERVER));
        if saved.is_none() {
            cfg.sign_in_hosts = baked.sign_in_hosts.clone();
        }
    }
    cfg
}

/// Writes a temporary file next to it, then renames it over the old one, so a crash or a full disk
/// mid-write never leaves a half-written config.json.
fn save_config(app: &AppHandle, cfg: &Config) -> Result<(), String> {
    use std::io::Write;
    let path = config_file(app).ok_or("Can't find the settings folder.")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    let written = std::fs::File::create(&tmp).and_then(|mut f| {
        f.write_all(json.as_bytes())?;
        f.sync_all()
    });
    if let Err(e) = written.and_then(|_| std::fs::rename(&tmp, &path)) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.to_string());
    }
    Ok(())
}

/// "ai.example.com" → "https://ai.example.com". Plain http only for this machine or the local network.
fn normalise_server(raw: &str) -> Option<String> {
    let raw = raw.trim().trim_end_matches('/');
    if raw.is_empty() {
        return None;
    }
    let with_scheme = if raw.contains("://") { raw.to_string() } else { format!("https://{raw}") };
    let url = Url::parse(&with_scheme).ok()?;
    let local = match url.host()? {
        url::Host::Domain(d) => is_local_name(d),
        url::Host::Ipv4(ip) => is_local_ip(IpAddr::V4(ip)),
        url::Host::Ipv6(ip) => is_local_ip(IpAddr::V6(ip)),
    };
    match url.scheme() {
        "https" => {}
        "http" if local => {}
        _ => return None,
    }
    Some(url.origin().ascii_serialization())
}

/// This Mac by name, or a name on the local network (Bonjour's .local).
fn is_local_name(host: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    host == "localhost" || host.ends_with(".localhost") || host.ends_with(".local")
}

/// This Mac, or a private or link-local address on the home network.
fn is_local_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_loopback() || v4.is_private() || v4.is_link_local(),
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_local_ip(IpAddr::V4(v4));
            }
            let first = v6.segments()[0];
            v6.is_loopback()
                // fc00::/7, unique local
                || (first & 0xfe00) == 0xfc00
                // fe80::/10, link-local
                || (first & 0xffc0) == 0xfe80
        }
    }
}

pub fn same_origin(a: &Url, origin: &str) -> bool {
    a.origin().ascii_serialization() == origin
}

/// Lets the server's own pages (that origin only, in the main window) use native.rs. Nothing else:
/// not the launcher's commands, not other sites, not the sign-in provider.
fn grant_native(app: &AppHandle, state: &State, origin: &str) {
    let mut s = state.guard();
    if s.granted.iter().any(|o| o == origin) {
        return;
    }
    let cap = CapabilityBuilder::new(format!("kith-server-{}", s.granted.len()))
        .remote(format!("{origin}/*"))
        .local(false)
        .window(MAIN)
        .permission("core:event:default")
        .permission("allow-native-info")
        .permission("allow-native-notify")
        .permission("allow-native-calendar-snapshot")
        .permission("allow-native-add-event")
        .permission("allow-native-add-reminder")
        .permission("allow-native-pick-document")
        .permission("allow-call-status");
    match app.add_capability(cap) {
        Ok(()) => s.granted.push(origin.to_string()),
        Err(e) => eprintln!("[kith] couldn't grant the server native access: {e}"),
    }
    // The mini call window (Kith.app only): the same server's /call-mini, with events (the call's
    // state from the main window), dragging itself, and its three buttons. Nothing else.
    // And for the main window in Kith.app only: Pip's voice made here, and listening along.
    if !who::parent_edition(app) {
        let child = CapabilityBuilder::new(format!("kith-child-{}", s.granted.len()))
            .remote(format!("{origin}/*"))
            .local(false)
            .window(MAIN)
            .permission("allow-voice-status")
            .permission("allow-voice-prepare")
            .permission("allow-voice-speak")
            .permission("allow-music-watch");
        if let Err(e) = app.add_capability(child) {
            eprintln!("[kith] couldn't grant Pip's voice and music: {e}");
        }
        let mini = CapabilityBuilder::new(format!("kith-mini-{}", s.granted.len()))
            .remote(format!("{origin}/*"))
            .local(false)
            .window(mini::MINI)
            .permission("core:event:default")
            .permission("core:window:allow-start-dragging")
            .permission("allow-mini-mute")
            .permission("allow-mini-end")
            .permission("allow-mini-focus-main");
        if let Err(e) = app.add_capability(mini) {
            eprintln!("[kith] couldn't grant the mini call window: {e}");
        }
    }
}

/// Decides where a navigation goes. `true` = inside the window.
fn allow_in_window(app: &AppHandle, state: &State, url: &Url) -> bool {
    let inside = decide(app, state, url);
    if std::env::var_os("KITH_DEBUG").is_some() {
        // Origin and path only: sign-in URLs carry one-time codes in the query.
        // Origin only: paths and queries carry one-time codes and handoff ids.
        eprintln!("[kith] {} {}", if inside { "window " } else { "outside" }, net::redact(url));
    }
    inside
}

fn decide(app: &AppHandle, state: &State, url: &Url) -> bool {
    match url.scheme() {
        // The bundled start page, Tauri's own schemes, and frames' blank/inline documents.
        "tauri" | "about" | "data" | "blob" | "asset" | "ipc" => return true,
        "http" | "https" => {}
        _ => {
            // mailto:, tel:, facetime: … go to the system.
            open_outside(app, state, url);
            return false;
        }
    }
    if url.host_str() == Some("tauri.localhost") {
        return true;
    }
    let mut s = state.guard();
    let server = s.config.server.clone();
    if let Some(server) = server.as_deref() {
        if same_origin(url, server) {
            // Sign-in happens in her browser (passkeys only work there), then is handed back.
            if url.path() == "/auth/login" && !url.query_pairs().any(|(k, _)| k == "handoff") {
                drop(s);
                signin::start(app, server.to_string());
                return false;
            }
            if !url.path().starts_with("/auth/") {
                // Signed in from the browser: come back to the front.
                if s.handoff.take().is_some_and(|t| t.elapsed() < Duration::from_secs(300)) {
                    let app = app.clone();
                    std::thread::spawn(move || {
                        let a = app.clone();
                        let _ = app.run_on_main_thread(move || show_main(&a));
                    });
                }
            }
            return true;
        }
    }
    let host = url.host_str().unwrap_or_default();
    // Only the hosts the config names, and only over https (or http on this Mac or the home network).
    if url.scheme() == "https" || normalise_server(url.as_str()).is_some() {
        if s.config.sign_in_hosts.iter().any(|h| h.eq_ignore_ascii_case(host)) {
            return true;
        }
    }
    drop(s);
    open_outside(app, state, url);
    false
}

/// Google's own pages that the file picker opens as a popup (sign-in and the picker itself).
fn google_popup(url: &Url) -> bool {
    url.scheme() == "https" && matches!(url.host_str(), Some("accounts.google.com" | "docs.google.com" | "drive.google.com"))
}

fn open_outside(app: &AppHandle, state: &State, url: &Url) {
    {
        let mut s = state.guard();
        if s.last_external.is_some_and(|t| t.elapsed() < Duration::from_secs(1)) {
            return;
        }
        s.last_external = Some(Instant::now());
    }
    let _ = app.opener().open_url(url.as_str(), None::<&str>);
}

/// Back to the start page, which checks the server is there before going to `path`.
fn go_via_launcher(app: &AppHandle, query: &str) {
    if let Some(w) = app.get_webview_window(MAIN) {
        let target = format!("tauri://localhost/index.html{query}");
        if let Ok(u) = Url::parse(&target) {
            let _ = w.navigate(u);
        }
    }
}

fn reload(app: &AppHandle, state: &State) {
    let Some(w) = app.get_webview_window(MAIN) else { return };
    let server = state.guard().config.server.clone();
    match (w.url(), server) {
        (Ok(u), Some(server)) if same_origin(&u, &server) => {
            let mut path = u.path().to_string();
            if let Some(q) = u.query() {
                path.push('?');
                path.push_str(q);
            }
            let enc: String = url::form_urlencoded::byte_serialize(path.as_bytes()).collect();
            go_via_launcher(app, &format!("?path={enc}"));
        }
        _ => go_via_launcher(app, ""),
    }
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// ⌃⌥Space, the menu-bar item and View › Call Pip: bring Kith forward and start a call.
fn call_pip(app: &AppHandle) {
    show_main(app);
    let _ = app.emit_to(MAIN, "kith:call", ());
}

/// Kith › Share Calendar & Reminders with Pip. Turning it on asks macOS first (once for each), and
/// only stays on if she lets Kith in to at least one of them.
fn set_share_calendar(app: &AppHandle, state: &State, on: bool) {
    let app = app.clone();
    let state = state.clone();
    std::thread::spawn(move || {
        let allowed = !on || {
            let cal = eventkit::request(eventkit::EVENT);
            let rem = eventkit::request(eventkit::REMINDER);
            cal == eventkit::Access::Allowed || rem == eventkit::Access::Allowed
        };
        let on = on && allowed;
        let cfg = {
            let mut s = state.guard();
            s.config.share_calendar = on;
            s.config.clone()
        };
        if let Err(e) = save_config(&app, &cfg) {
            eprintln!("[kith] couldn't save settings: {e}");
        }
        refresh_calendar_menu(&app, &state);
        if !allowed {
            app.dialog()
                .message("Kith isn't allowed to see your Calendar or Reminders, so nothing is shared. You can let it in from System Settings › Privacy & Security › Calendars (or Reminders), then tick this again.")
                .title("Calendar & Reminders")
                .kind(MessageDialogKind::Info)
                .blocking_show();
        }
        // The page sends the new snapshot (or clears the old one) on the server.
        let _ = app.emit_to(MAIN, "kith:calendar", on);
    });
}

/// "School, Home" / "3 calendars" / "no calendars": short enough for a menu, and exact.
fn shared_names(all: &[eventkit::Source], chosen: &eventkit::Chosen, one: &str, many: &str) -> String {
    let names: Vec<&str> = all.iter().filter(|c| eventkit::is_chosen(chosen, &c.id)).map(|c| c.title.as_str()).collect();
    match names.len() {
        0 => format!("no {many}"),
        1..=3 => {
            let list = names.join(", ");
            if list.chars().count() <= 48 { list } else { format!("{} {}", names.len(), if names.len() == 1 { one } else { many }) }
        }
        n => format!("{n} {many}"),
    }
}

/// Rebuilds Kith › Choose What Pip Sees from her calendars and lists, and the "Pip sees" line.
fn refresh_calendar_menu(app: &AppHandle, state: &State) {
    let (on, cal_ids, list_ids) = {
        let s = state.guard();
        (s.config.share_calendar, s.config.share_calendars.clone(), s.config.share_lists.clone())
    };
    let cals = eventkit::sources(eventkit::EVENT);
    let lists = eventkit::sources(eventkit::REMINDER);
    let sees = if !on {
        "Pip sees nothing from Calendar or Reminders".to_string()
    } else {
        let mut parts = vec![];
        if eventkit::access(eventkit::EVENT) == eventkit::Access::Allowed {
            parts.push(format!("{} (next 7 days)", shared_names(&cals, &cal_ids, "calendar", "calendars")));
        }
        if eventkit::access(eventkit::REMINDER) == eventkit::Access::Allowed {
            parts.push(format!("{} (due in the next 7 days)", shared_names(&lists, &list_ids, "list", "lists")));
        }
        if parts.is_empty() { "Pip sees nothing (Kith isn't allowed in)".to_string() } else { format!("Pip sees: {}", parts.join(" · ")) }
    };
    let a = app.clone();
    let _ = app.run_on_main_thread(move || {
        let Some(ui) = a.try_state::<Ui>() else { return };
        // The tick shows what's saved (it stays off if macOS said no).
        let _ = ui.share.set_checked(on);
        let _ = ui.sees.set_text(&sees);
        let menu = &ui.choose;
        if let Ok(items) = menu.items() {
            for it in items {
                let _ = menu.remove(&it);
            }
        }
        let header = |t: &str| MenuItem::new(&a, t, false, None::<&str>);
        let add = |kind: &str, title: &str, srcs: &[eventkit::Source], chosen: &eventkit::Chosen| {
            if let Ok(h) = header(title) {
                let _ = menu.append(&h);
            }
            if srcs.is_empty() {
                if let Ok(h) = header(if on { "  (none, or Kith isn't allowed in)" } else { "  (turn on sharing first)" }) {
                    let _ = menu.append(&h);
                }
            }
            for c in srcs {
                if let Ok(item) = CheckMenuItem::with_id(&a, format!("{kind}:{}", c.id), &c.title, on, eventkit::is_chosen(chosen, &c.id), None::<&str>) {
                    let _ = menu.append(&item);
                }
            }
        };
        add("cal", "Calendars", &cals, &cal_ids);
        if let Ok(sep) = PredefinedMenuItem::separator(&a) {
            let _ = menu.append(&sep);
        }
        add("list", "Reminder lists", &lists, &list_ids);
    });
}

/// A calendar or list ticked or unticked in Choose What Pip Sees.
fn toggle_source(app: &AppHandle, state: &State, kind: &str, id: &str) {
    let all: Vec<String> = eventkit::sources(if kind == "cal" { eventkit::EVENT } else { eventkit::REMINDER }).into_iter().map(|c| c.id).collect();
    let cfg = {
        let mut s = state.guard();
        let chosen = if kind == "cal" { &mut s.config.share_calendars } else { &mut s.config.share_lists };
        // From "all of them" to an explicit list, so calendars added later aren't shared without her say.
        let mut ids: Vec<String> = chosen.clone().unwrap_or_else(|| all.clone());
        if let Some(i) = ids.iter().position(|c| c == id) {
            ids.remove(i);
        } else if all.iter().any(|c| c == id) {
            ids.push(id.to_string());
        }
        *chosen = Some(ids);
        s.config.clone()
    };
    if let Err(e) = save_config(app, &cfg) {
        eprintln!("[kith] couldn't save settings: {e}");
    }
    refresh_calendar_menu(app, state);
    let _ = app.emit_to(MAIN, "kith:calendar", cfg.share_calendar);
}

// ── Commands for the bundled start page only (see capabilities/default.json) ──────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Setup {
    server: Option<String>,
    app_name: &'static str,
    /// No changing the server here (Kith with a server baked in).
    locked: bool,
}

#[tauri::command]
fn setup_info(app: AppHandle, state: tauri::State<'_, State>) -> Setup {
    Setup { server: state.guard().config.server.clone(), app_name: who::name_for(&app, who::Role::SignedOut), locked: !can_change_server(&app) }
}

/// Saves the server chosen on the start page. Refused in a locked Kith; Kith Parent with a baked-in
/// server asks first. Moving to another server restarts the app, which takes the native commands
/// away from the old one.
#[tauri::command]
async fn save_server(app: AppHandle, state: tauri::State<'_, State>, server: String) -> Result<String, String> {
    if !can_change_server(&app) {
        return Err("This Kith is set up for one home server, so its address can't be changed here.".into());
    }
    let origin = normalise_server(&server).ok_or("That doesn't look like a web address. Try something like ai.example.com.")?;
    let current = state.guard().config.server.clone();
    if current.as_deref() == Some(origin.as_str()) {
        return Ok(origin);
    }
    if let Some(baked) = baked_server().filter(|b| *b != origin) {
        let a = app.clone();
        let o = origin.clone();
        let yes = tauri::async_runtime::spawn_blocking(move || {
            a.dialog()
                .message(format!("This app was set up for {baked}. Switch it to {o}? Kith Parent will restart, and you'll sign in there."))
                .title("Change the Kith server?")
                .kind(MessageDialogKind::Warning)
                .buttons(MessageDialogButtons::OkCancelCustom("Change Server".into(), "Cancel".into()))
                .blocking_show()
        })
        .await
        .map_err(|e| e.to_string())?;
        if !yes {
            return Err("Kept the same server.".into());
        }
    }
    let cfg = {
        let mut s = state.guard();
        s.config.server = Some(origin.clone());
        s.config.clone()
    };
    save_config(&app, &cfg)?;
    let granted_elsewhere = state.guard().granted.iter().any(|o| *o != origin);
    if granted_elsewhere {
        // The old server's pages still hold the native capability: only a fresh start drops it.
        app.restart();
    }
    grant_native(&app, state.inner(), &origin);
    Ok(origin)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WrongApp {
    words: Option<String>,
    /// The other app's name, if it's installed on this Mac.
    other: Option<String>,
}

#[tauri::command]
fn wrong_app_info(app: AppHandle, state: tauri::State<'_, State>) -> WrongApp {
    let (id, name) = who::other_app(&app);
    WrongApp { words: state.guard().wrong.clone(), other: installed(id).then(|| name.to_string()) }
}

fn installed(bundle_id: &str) -> bool {
    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::NSString;
    NSWorkspace::sharedWorkspace().URLForApplicationWithBundleIdentifier(&NSString::from_str(bundle_id)).is_some()
}

#[tauri::command]
fn open_other_app(app: AppHandle) -> Result<(), String> {
    let (id, _) = who::other_app(&app);
    std::process::Command::new("/usr/bin/open").args(["-b", id]).status().map_err(|e| e.to_string())?;
    Ok(())
}

/// Signs out here (and of the sign-in provider in her browser, so the next sign-in can be someone
/// else), clears this app's web data, then the start page carries on to sign-in.
#[tauri::command]
async fn switch_account(app: AppHandle, state: tauri::State<'_, State>) -> Result<(), String> {
    let server = state.guard().config.server.clone().ok_or("No server.")?;
    let app2 = app.clone();
    let ended = tauri::async_runtime::spawn_blocking(move || {
        let Some(sid) = who::session_cookie(&app2, &server) else { return Ok(None) }; // not signed in here
        #[derive(Deserialize)]
        struct Out {
            redirect: Option<String>,
        }
        let agent = net::agent();
        let mut last = String::new();
        // A few tries: clearing this app's data without ending the session would leave it valid.
        for attempt in 0..3 {
            if attempt > 0 {
                std::thread::sleep(Duration::from_secs(2));
            }
            match agent.post(&format!("{server}/auth/logout")).header("Cookie", &net::session(&sid)).header("X-Kith", "1").send_empty() {
                Ok(mut r) if r.status().is_success() => {
                    let out: Option<Out> = r.body_mut().read_to_string().ok().and_then(|b| serde_json::from_str(&b).ok());
                    return Ok(out.and_then(|o| o.redirect));
                }
                // Already signed out there.
                Ok(r) if r.status().as_u16() == 401 => return Ok(None),
                Ok(r) => last = format!("the server answered {}", r.status()),
                Err(e) => last = e.to_string(),
            }
        }
        Err(last)
    })
    .await
    .map_err(|e| e.to_string())?;
    let redirect = ended.map_err(|why| {
        if std::env::var_os("KITH_DEBUG").is_some() {
            eprintln!("[kith] sign-out failed: {why}");
        }
        "Couldn't sign out on your Kith server, so you're still signed in. Check you're online and try again.".to_string()
    })?;
    if let Some(w) = app.get_webview_window(MAIN) {
        let _ = w.clear_all_browsing_data();
    }
    state.guard().wrong = None;
    if let Some(url) = redirect.filter(|u| u.starts_with("https://") || u.starts_with("http://")) {
        let _ = app.opener().open_url(url, None::<&str>);
    }
    Ok(())
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // Size and position only: closing hides the window (Kith stays in the menu bar), and it
        // must still open visible next time.
        .plugin(tauri_plugin_window_state::Builder::default().with_state_flags(StateFlags::all() - StateFlags::VISIBLE).build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        // Inert until updater.rs is given an address and key (tauri.conf.json has empty placeholders).
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        call_pip(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            setup_info,
            save_server,
            wrong_app_info,
            switch_account,
            open_other_app,
            native::native_info,
            native::native_notify,
            native::native_calendar_snapshot,
            native::native_add_event,
            native::native_add_reminder,
            native::native_pick_document,
            mini::call_status,
            mini::mini_mute,
            mini::mini_end,
            mini::mini_focus_main,
            voice::voice_status,
            voice::voice_prepare,
            voice::voice_speak,
            music::music_watch,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let state: State = Arc::new(Mutex::new(Shell { config: load_config(&handle), ..Default::default() }));
            app.manage(state.clone());
            app.manage(voice::Voice::new(&handle));
            voice::start(&handle);
            app.manage(music::Music::default());
            // Bind first: a lock held in the `if let` would still be held inside grant_native.
            let server = state.guard().config.server.clone();
            if let Some(server) = server {
                grant_native(&handle, &state, &server);
            }

            // Menu: the usual Mac menus (Edit matters: copy and paste), plus Reload (⌘R) and Call Pip.
            let reload_item = MenuItem::with_id(app, "reload", "Reload", true, Some("CmdOrCtrl+R"))?;
            let call_item = MenuItem::with_id(app, "call", "Call Pip", true, Some("Ctrl+Alt+Space"))?;
            let server_item = MenuItem::with_id(app, "server", "Change Server…", true, None::<&str>)?;
            let share_on = state.guard().config.share_calendar;
            let share_item = CheckMenuItem::with_id(app, "share-calendar", "Share Calendar & Reminders with Pip", true, share_on, None::<&str>)?;
            let choose_menu = Submenu::with_items(app, "Choose What Pip Sees", true, &[])?;
            let sees_item = MenuItem::new(app, "", false, None::<&str>)?;
            // The parent build (tauri.parent.conf.json) is "Kith Parent" throughout.
            let parent_build = who::parent_edition(&handle);
            let app_name = who::name_for(&handle, who::Role::SignedOut);
            let about = AboutMetadata { name: Some(app_name.into()), ..Default::default() };
            let menu = Menu::with_items(
                app,
                &[
                    &Submenu::with_items(
                        app,
                        app_name,
                        true,
                        &[
                            &PredefinedMenuItem::about(app, None, Some(about))?,
                            &PredefinedMenuItem::separator(app)?,
                            &share_item,
                            &choose_menu,
                            &sees_item,
                            &PredefinedMenuItem::separator(app)?,
                            &PredefinedMenuItem::services(app, None)?,
                            &PredefinedMenuItem::separator(app)?,
                            &PredefinedMenuItem::hide(app, None)?,
                            &PredefinedMenuItem::hide_others(app, None)?,
                            &PredefinedMenuItem::show_all(app, None)?,
                            &PredefinedMenuItem::separator(app)?,
                            &PredefinedMenuItem::quit(app, None)?,
                        ],
                    )?,
                    &Submenu::with_items(
                        app,
                        "Edit",
                        true,
                        &[
                            &PredefinedMenuItem::undo(app, None)?,
                            &PredefinedMenuItem::redo(app, None)?,
                            &PredefinedMenuItem::separator(app)?,
                            &PredefinedMenuItem::cut(app, None)?,
                            &PredefinedMenuItem::copy(app, None)?,
                            &PredefinedMenuItem::paste(app, None)?,
                            &PredefinedMenuItem::select_all(app, None)?,
                        ],
                    )?,
                    &Submenu::with_items(app, "View", true, &[&call_item, &reload_item, &PredefinedMenuItem::separator(app)?, &PredefinedMenuItem::fullscreen(app, None)?])?,
                    &Submenu::with_items(
                        app,
                        "Window",
                        true,
                        &[&PredefinedMenuItem::minimize(app, None)?, &PredefinedMenuItem::maximize(app, None)?, &PredefinedMenuItem::separator(app)?, &PredefinedMenuItem::close_window(app, None)?],
                    )?,
                ],
            )?;
            // Change Server: not in Kith when a server is baked in (Kith Parent asks first, save_server).
            if can_change_server(&handle) {
                if let Some(app_menu) = menu.items()?.first().and_then(|m| m.as_submenu().cloned()) {
                    // After About, the separator, sharing, Choose What Pip Sees and "Pip sees".
                    app_menu.insert(&server_item, 5)?;
                }
            }
            app.set_menu(menu)?;
            let st = state.clone();
            let share_menu = share_item.clone();
            app.on_menu_event(move |app, ev| match ev.id().as_ref() {
                "reload" => reload(app, &st),
                // Only in the menu where it can be used; checked again in case.
                "server" => {
                    if can_change_server(app) {
                        show_main(app);
                        go_via_launcher(app, "?setup=1")
                    }
                }
                "call" | "tray-call" => call_pip(app),
                "tray-open" => show_main(app),
                "tray-quit" => app.exit(0),
                "share-calendar" => {
                    let on = share_menu.is_checked().unwrap_or(false);
                    set_share_calendar(app, &st, on);
                }
                id => {
                    if let Some((kind @ ("cal" | "list"), source)) = id.split_once(':') {
                        let (app, st, kind, source) = (app.clone(), st.clone(), kind.to_string(), source.to_string());
                        std::thread::spawn(move || toggle_source(&app, &st, &kind, &source));
                    }
                }
            });

            // Menu bar: Kith stays here when its window is closed, so notifications still arrive.
            let tray_open = MenuItem::with_id(app, "tray-open", format!("Open {app_name}"), true, None::<&str>)?;
            let tray_call = MenuItem::with_id(app, "tray-call", "Call Pip", !parent_build, Some("Ctrl+Alt+Space"))?;
            let tray_quit = MenuItem::with_id(app, "tray-quit", format!("Quit {app_name}"), true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&tray_open, &tray_call, &PredefinedMenuItem::separator(app)?, &tray_quit])?;
            TrayIconBuilder::with_id("kith")
                .icon(tauri::image::Image::from_bytes(include_bytes!("../../../design/icon/icons/menubar/menubarTemplate@2x.png"))?)
                .icon_as_template(true)
                .tooltip(app_name)
                .menu(&tray_menu)
                .build(app)?;
            app.manage(Ui { call: call_item.clone(), tray_call, tray_open, tray_quit, share: share_item.clone(), choose: choose_menu.clone(), sees: sees_item.clone() });
            {
                let (app, st) = (handle.clone(), state.clone());
                std::thread::spawn(move || refresh_calendar_menu(&app, &st));
            }

            // ⌃⌥Space from anywhere (not in the parent build). If another app already uses it,
            // Kith carries on without it.
            if !parent_build {
                if let Err(e) = app.global_shortcut().register(native::CALL_SHORTCUT) {
                    eprintln!("[kith] {} is taken: {e}", native::CALL_SHORTCUT_LABEL);
                }
            }

            let nav_state = state.clone();
            let nav_app = handle.clone();
            let win_state = state.clone();
            let win_app = handle.clone();
            let window = WebviewWindowBuilder::new(app, MAIN, WebviewUrl::App("index.html".into()))
                .title(app_name)
                // Tells Kith's page which app this is, so it sends X-Kith-App (each app lets in only its own person).
                .initialization_script(format!("window.__KITH_APP__ = {:?};", who::hint(&handle)))
                .inner_size(1500.0, 920.0)
                // The web app's desktop layout (sidebar, chat, Pip's desk) starts at 1100px.
                .min_inner_size(1100.0, 640.0)
                .center()
                .title_bar_style(tauri::TitleBarStyle::Transparent)
                .hidden_title(true)
                .background_color(tauri::window::Color(0x1c, 0x12, 0x19, 0xff))
                .on_page_load(|_w, p| {
                    // A Kith page just loaded: check who's signed in now, not in up to 30 seconds.
                    if matches!(p.event(), tauri::webview::PageLoadEvent::Finished) && p.url().scheme().starts_with("http") {
                        who::nudge();
                    }
                    if std::env::var_os("KITH_DEBUG").is_some() {
                        eprintln!("[kith] page {:?} {}", p.event(), net::redact(p.url()));
                    }
                })
                .on_navigation(move |url| allow_in_window(&nav_app, &nav_state, url))
                .on_new_window(move |url, features| {
                    // window.open / target=_blank. Our own pages load in the main window; Google's
                    // sign-in for its file picker opens as a small window inside Kith (it must be a
                    // real popup that shares this web view's storage, or the picker never hears back);
                    // the rest go to the browser.
                    if google_popup(&url) {
                        static N: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
                        let label = format!("google-{}", N.fetch_add(1, std::sync::atomic::Ordering::Relaxed));
                        match WebviewWindowBuilder::new(&win_app, label, WebviewUrl::External(url.clone()))
                            .window_features(features)
                            .title("Google")
                            .build()
                        {
                            Ok(window) => return NewWindowResponse::Create { window },
                            Err(e) => eprintln!("[kith] couldn't open Google's window: {e}"),
                        }
                    }
                    let server = win_state.guard().config.server.clone();
                    if server.as_deref().is_some_and(|s| same_origin(&url, s)) {
                        if let Some(w) = win_app.get_webview_window(MAIN) {
                            let _ = w.navigate(url);
                        }
                    } else {
                        open_outside(&win_app, &win_state, &url);
                    }
                    NewWindowResponse::Deny
                })
                .build()?;

            let _ = window.show();
            apply_role(&handle, who::Role::SignedOut);
            who::start(handle.clone(), state.clone());
            let (update_url, update_key) = {
                let s = state.guard();
                (s.config.update_url.clone(), s.config.update_public_key.clone())
            };
            updater::start(handle.clone(), update_url, update_key);
            let drop_app = handle.clone();
            window.on_window_event(move |ev| match ev {
                // Closing the window keeps Kith running in the menu bar (Quit from the menu to stop).
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    if let Some(w) = drop_app.get_webview_window(MAIN) {
                        let _ = w.hide();
                    }
                }
                // During a call: a small Pip window while she's in another app, gone when she's back.
                WindowEvent::Focused(focused) => mini::main_focused(&drop_app, *focused),
                // A document dropped on the window: read its text and hand it to the chat.
                WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) => {
                    if let Some(path) = paths.first().cloned() {
                        let app = drop_app.clone();
                        std::thread::spawn(move || {
                            let payload = match files::read_document(&path) {
                                Ok(f) => serde_json::json!({ "ok": true, "file": f }),
                                Err(e) => serde_json::json!({ "ok": false, "error": e }),
                            };
                            let _ = app.emit_to(MAIN, "kith:file", payload);
                        });
                    }
                }
                _ => {}
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Kith");

    app.run(|app, event| {
        // Clicking the Dock icon brings the window back.
        if let RunEvent::Reopen { .. } = event {
            show_main(app);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_http_only_for_this_mac_or_the_home_network() {
        for ok in ["http://localhost:8787", "http://kith.local", "http://127.0.0.1:8787", "http://192.168.1.20", "http://10.0.0.5", "http://172.16.4.1", "http://172.31.255.1", "http://169.254.1.1", "http://[::1]:8787", "http://[fd00::1]", "http://[fe80::1]"] {
            assert!(normalise_server(ok).is_some(), "{ok} should be allowed");
        }
        // Look-alikes that a prefix check let through, and public addresses.
        for bad in ["http://10.evil.com", "http://192.168.1.1.evil.com", "http://127.0.0.1.nip.io", "http://172.32.0.1", "http://8.8.8.8", "http://example.com", "http://[2001:db8::1]", "ftp://kith.local"] {
            assert!(normalise_server(bad).is_none(), "{bad} should be refused");
        }
        assert_eq!(normalise_server("ai.example.com/").as_deref(), Some("https://ai.example.com"));
        assert_eq!(normalise_server("http://Kith.Local:8787/chat").as_deref(), Some("http://kith.local:8787"));
    }

    #[test]
    fn pip_sees_says_exactly_what_is_shared() {
        let src = |id: &str, t: &str| eventkit::Source { id: id.into(), title: t.into() };
        let all = vec![src("a", "Home"), src("b", "School"), src("c", "Work")];
        assert_eq!(shared_names(&all, &None, "calendar", "calendars"), "Home, School, Work");
        assert_eq!(shared_names(&all, &Some(vec!["b".into()]), "calendar", "calendars"), "School");
        assert_eq!(shared_names(&all, &Some(vec![]), "calendar", "calendars"), "no calendars");
        let many: Vec<_> = (0..5).map(|i| src(&i.to_string(), "X")).collect();
        assert_eq!(shared_names(&many, &None, "calendar", "calendars"), "5 calendars");
    }
}
