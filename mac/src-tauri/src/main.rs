// Kith for the Mac: your own Kith server in a Mac window, plus the parts of the Mac Pip can use.
//
// The window shows the live web app, so sign-in, cookies, the sandboxed desk frames and every
// future change are the same as on the web. A small bundled start page (../launcher) checks the
// server is there and shows a friendly screen when home can't be reached.
//
// The Mac side (native.rs), offered to the server's own pages only:
// - Mac notifications for Pip's check-ins and reminders; Kith stays in the menu bar when closed;
// - Calendar & Reminders (eventkit.rs), only while she has it switched on in the Kith menu;
//   anything Pip adds is confirmed in a native prompt first;
// - documents she picks or drops on the window (files.rs: text only, no photos);
// - ⌃⌥Space from anywhere to call Pip.
//
// Where pages may open:
// - the Kith server itself, inside the window;
// - the sign-in provider, inside the window: anything reached while signing in (after
//   <server>/auth/login, until we're back on the server), plus any `signInHosts` in the config.
//   Never the user's browser, where the sign-in cookie would land in the wrong place;
// - everything else (Google Drive links, links in chat) in the default browser.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod eventkit;
mod files;
mod native;

use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::ipc::CapabilityBuilder;
use tauri::menu::{AboutMetadata, CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, DragDropEvent, Emitter, Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_window_state::StateFlags;

const MAIN: &str = "main";
/// Used when neither a saved address nor a built-in one is set: a Kith server on this Mac
/// (`docker compose up` serves it on port 8787).
const DEFAULT_SERVER: &str = "http://localhost:8787";
/// How long sign-in may wander off to the provider before we stop treating other hosts as part of it.
const SIGNIN_WINDOW: Duration = Duration::from_secs(15 * 60);

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Config {
    #[serde(default)]
    server: Option<String>,
    #[serde(default)]
    sign_in_hosts: Vec<String>,
    /// Kith › Share Calendar & Reminders with Pip. Off until she turns it on.
    #[serde(default)]
    share_calendar: bool,
}

#[derive(Default)]
pub struct Shell {
    config: Config,
    /// Set when the window goes to <server>/auth/login; cleared when it's back on the server.
    signing_in: Option<Instant>,
    /// Pages in the desk could try to open lots of links; one browser open per second at most.
    last_external: Option<Instant>,
    /// Recent notifications, to cap how many a page can show.
    notify_times: Vec<Instant>,
    /// Origins already given the native capability this run.
    granted: Vec<String>,
}

pub type State = Arc<Mutex<Shell>>;

fn config_file(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("config.json"))
}

/// The saved config (chosen in the app) wins over the one baked in at build time.
fn load_config(app: &AppHandle) -> Config {
    let saved = config_file(app).and_then(|p| std::fs::read_to_string(p).ok());
    let baked = option_env!("KITH_DEFAULT_CONFIG").filter(|s| !s.is_empty()).map(String::from);
    let mut cfg: Config = saved
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .or_else(|| baked.as_deref().and_then(|s| serde_json::from_str(s).ok()))
        .unwrap_or_default();
    cfg.server = cfg.server.as_deref().and_then(normalise_server).or_else(|| normalise_server(DEFAULT_SERVER));
    cfg
}

fn save_config(app: &AppHandle, cfg: &Config) -> Result<(), String> {
    let path = config_file(app).ok_or("Can't find the settings folder.")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, serde_json::to_string_pretty(cfg).unwrap()).map_err(|e| e.to_string())
}

/// "ai.example.com" → "https://ai.example.com". Plain http only for this machine or the local network.
fn normalise_server(raw: &str) -> Option<String> {
    let raw = raw.trim().trim_end_matches('/');
    if raw.is_empty() {
        return None;
    }
    let with_scheme = if raw.contains("://") { raw.to_string() } else { format!("https://{raw}") };
    let url = Url::parse(&with_scheme).ok()?;
    let host = url.host_str()?.to_string();
    let local = host == "localhost" || host == "127.0.0.1" || host.ends_with(".local") || host.starts_with("192.168.") || host.starts_with("10.");
    match url.scheme() {
        "https" => {}
        "http" if local => {}
        _ => return None,
    }
    Some(url.origin().ascii_serialization())
}

fn same_origin(a: &Url, origin: &str) -> bool {
    a.origin().ascii_serialization() == origin
}

/// Lets the server's own pages (that origin only, in the main window) use native.rs. Nothing else:
/// not the launcher's commands, not other sites, not the sign-in provider.
fn grant_native(app: &AppHandle, state: &State, origin: &str) {
    let mut s = state.lock().unwrap();
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
        .permission("allow-native-pick-document");
    match app.add_capability(cap) {
        Ok(()) => s.granted.push(origin.to_string()),
        Err(e) => eprintln!("[kith] couldn't grant the server native access: {e}"),
    }
}

/// Decides where a navigation goes. `true` = inside the window.
fn allow_in_window(app: &AppHandle, state: &State, url: &Url) -> bool {
    let inside = decide(app, state, url);
    if std::env::var_os("KITH_DEBUG").is_some() {
        // Origin and path only: sign-in URLs carry one-time codes in the query.
        eprintln!("[kith] {} {}{}", if inside { "window " } else { "outside" }, url.origin().ascii_serialization(), url.path());
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
    let mut s = state.lock().unwrap();
    let server = s.config.server.clone();
    if let Some(server) = server.as_deref() {
        if same_origin(url, server) {
            if url.path().starts_with("/auth/login") {
                s.signing_in = Some(Instant::now());
            } else if !url.path().starts_with("/auth/") {
                s.signing_in = None;
            }
            return true;
        }
    }
    let host = url.host_str().unwrap_or_default();
    if s.config.sign_in_hosts.iter().any(|h| h.eq_ignore_ascii_case(host)) {
        return true;
    }
    if url.scheme() == "https" && s.signing_in.is_some_and(|t| t.elapsed() < SIGNIN_WINDOW) {
        return true;
    }
    drop(s);
    open_outside(app, state, url);
    false
}

fn open_outside(app: &AppHandle, state: &State, url: &Url) {
    {
        let mut s = state.lock().unwrap();
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
    let server = state.lock().unwrap().config.server.clone();
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

fn set_share_calendar(app: &AppHandle, state: &State, on: bool) {
    let cfg = {
        let mut s = state.lock().unwrap();
        s.config.share_calendar = on;
        s.config.clone()
    };
    let _ = save_config(app, &cfg);
    let app2 = app.clone();
    std::thread::spawn(move || {
        if on {
            // macOS asks her, once for each.
            eventkit::request(eventkit::EVENT);
            eventkit::request(eventkit::REMINDER);
        }
        // The page sends the new snapshot (or clears the old one) on the server.
        let _ = app2.emit_to(MAIN, "kith:calendar", on);
    });
}

// ── Commands for the bundled start page only (see capabilities/default.json) ──────────────

#[derive(Serialize)]
struct Setup {
    server: Option<String>,
}

#[tauri::command]
fn setup_info(state: tauri::State<'_, State>) -> Setup {
    Setup { server: state.lock().unwrap().config.server.clone() }
}

#[tauri::command]
fn save_server(app: AppHandle, state: tauri::State<'_, State>, server: String) -> Result<String, String> {
    let origin = normalise_server(&server).ok_or("That doesn't look like a web address. Try something like ai.example.com.")?;
    let cfg = {
        let mut s = state.lock().unwrap();
        s.config.server = Some(origin.clone());
        s.config.clone()
    };
    save_config(&app, &cfg)?;
    grant_native(&app, state.inner(), &origin);
    Ok(origin)
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // Size and position only: closing hides the window (Kith stays in the menu bar), and it
        // must still open visible next time.
        .plugin(tauri_plugin_window_state::Builder::default().with_state_flags(StateFlags::all() - StateFlags::VISIBLE).build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
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
            native::native_info,
            native::native_notify,
            native::native_calendar_snapshot,
            native::native_add_event,
            native::native_add_reminder,
            native::native_pick_document,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let state: State = Arc::new(Mutex::new(Shell { config: load_config(&handle), ..Default::default() }));
            app.manage(state.clone());
            // Bind first: a lock held in the `if let` would still be held inside grant_native.
            let server = state.lock().unwrap().config.server.clone();
            if let Some(server) = server {
                grant_native(&handle, &state, &server);
            }

            // Menu: the usual Mac menus (Edit matters: copy and paste), plus Reload (⌘R) and Call Pip.
            let reload_item = MenuItem::with_id(app, "reload", "Reload", true, Some("CmdOrCtrl+R"))?;
            let call_item = MenuItem::with_id(app, "call", "Call Pip", true, Some("Ctrl+Alt+Space"))?;
            let server_item = MenuItem::with_id(app, "server", "Change Server…", true, None::<&str>)?;
            let share_on = state.lock().unwrap().config.share_calendar;
            let share_item = CheckMenuItem::with_id(app, "share-calendar", "Share Calendar & Reminders with Pip", true, share_on, None::<&str>)?;
            let about = AboutMetadata { name: Some("Kith".into()), ..Default::default() };
            let menu = Menu::with_items(
                app,
                &[
                    &Submenu::with_items(
                        app,
                        "Kith",
                        true,
                        &[
                            &PredefinedMenuItem::about(app, None, Some(about))?,
                            &PredefinedMenuItem::separator(app)?,
                            &share_item,
                            &server_item,
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
            app.set_menu(menu)?;
            let st = state.clone();
            let share_menu = share_item.clone();
            app.on_menu_event(move |app, ev| match ev.id().as_ref() {
                "reload" => reload(app, &st),
                "server" => {
                    show_main(app);
                    go_via_launcher(app, "?setup=1")
                }
                "call" | "tray-call" => call_pip(app),
                "tray-open" => show_main(app),
                "tray-quit" => app.exit(0),
                "share-calendar" => {
                    let on = share_menu.is_checked().unwrap_or(false);
                    set_share_calendar(app, &st, on);
                }
                _ => {}
            });

            // Menu bar: Kith stays here when its window is closed, so notifications still arrive.
            let tray_menu = Menu::with_items(
                app,
                &[
                    &MenuItem::with_id(app, "tray-open", "Open Kith", true, None::<&str>)?,
                    &MenuItem::with_id(app, "tray-call", "Call Pip", true, Some("Ctrl+Alt+Space"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::with_id(app, "tray-quit", "Quit Kith", true, None::<&str>)?,
                ],
            )?;
            TrayIconBuilder::with_id("kith")
                .icon(tauri::image::Image::from_bytes(include_bytes!("../../../design/icon/icons/menubar/menubarTemplate@2x.png"))?)
                .icon_as_template(true)
                .tooltip("Kith")
                .menu(&tray_menu)
                .build(app)?;

            // ⌃⌥Space from anywhere. If another app already uses it, Kith carries on without it.
            if let Err(e) = app.global_shortcut().register(native::CALL_SHORTCUT) {
                eprintln!("[kith] {} is taken: {e}", native::CALL_SHORTCUT_LABEL);
            }

            let nav_state = state.clone();
            let nav_app = handle.clone();
            let win_state = state.clone();
            let win_app = handle.clone();
            let window = WebviewWindowBuilder::new(app, MAIN, WebviewUrl::App("index.html".into()))
                .title("Kith")
                .inner_size(1500.0, 920.0)
                // The web app's desktop layout (sidebar, chat, Pip's desk) starts at 1100px.
                .min_inner_size(1100.0, 640.0)
                .center()
                .title_bar_style(tauri::TitleBarStyle::Transparent)
                .hidden_title(true)
                .background_color(tauri::window::Color(0x1c, 0x12, 0x19, 0xff))
                .on_page_load(|_w, p| {
                    if std::env::var_os("KITH_DEBUG").is_some() {
                        eprintln!("[kith] page {:?} {}{}", p.event(), p.url().origin().ascii_serialization(), p.url().path());
                    }
                })
                .on_navigation(move |url| allow_in_window(&nav_app, &nav_state, url))
                .on_new_window(move |url, _features| {
                    // window.open / target=_blank. Our own pages load in the main window; the rest go
                    // to the browser. Never a second web view (it wouldn't share the sign-in).
                    let server = win_state.lock().unwrap().config.server.clone();
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
            let drop_app = handle.clone();
            window.on_window_event(move |ev| match ev {
                // Closing the window keeps Kith running in the menu bar (Quit from the menu to stop).
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    if let Some(w) = drop_app.get_webview_window(MAIN) {
                        let _ = w.hide();
                    }
                }
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
