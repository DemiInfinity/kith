// The mini call window: when a call is on and she switches to another app (Kith's window loses
// focus or is minimised), a small portrait window with Pip floats over everything, on whichever
// space she's on. Clicking Pip brings Kith back; when Kith's window has focus again it closes.
// Only in Kith.app, the child's; never in Kith Parent.
//
// The window loads /call-mini from the Kith server (nowhere else: other navigations are refused),
// and only shows the call: the voice, the microphone and the turns stay in the main window. The
// main window sends it the call's state by Tauri events (client/src/lib/callMac.ts); its buttons
// are the three commands here, each checked to come from the mini window itself.

use crate::{same_origin, show_main, who, LockExt, State, MAIN};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Emitter, Manager, Url, WebviewUrl, WebviewWindowBuilder};

pub const MINI: &str = "mini";
const WIDTH: f64 = 220.0;
const HEIGHT: f64 = 360.0;

/// A call is on in the main window (it says so with call_status).
static RUNNING: AtomicBool = AtomicBool::new(false);

/// The page's commands only count from the window they belong to.
fn from(window: &tauri::Window, label: &str) -> Result<(), String> {
    if window.label() == label {
        Ok(())
    } else {
        Err("Not from this window.".into())
    }
}

/// The main window: a call started (true) or ended (false).
#[tauri::command]
pub fn call_status(app: AppHandle, window: tauri::Window, running: bool) -> Result<(), String> {
    from(&window, MAIN)?;
    if who::parent_edition(&app) {
        return Ok(());
    }
    RUNNING.store(running, Ordering::Relaxed);
    if !running {
        close(&app);
    } else if let Some(w) = app.get_webview_window(MAIN) {
        // Started while she's already elsewhere (⌃⌥Space from another app brings Kith forward, so rarely).
        if !w.is_focused().unwrap_or(true) {
            show(&app);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn mini_mute(app: AppHandle, window: tauri::Window) -> Result<(), String> {
    from(&window, MINI)?;
    app.emit_to(MAIN, "kith:mini-action", "mute").map_err(|e| e.to_string())
}

#[tauri::command]
pub fn mini_end(app: AppHandle, window: tauri::Window) -> Result<(), String> {
    from(&window, MINI)?;
    RUNNING.store(false, Ordering::Relaxed);
    let _ = app.emit_to(MAIN, "kith:mini-action", "end");
    // After this command has answered (it came from the window being closed).
    let a = app.clone();
    let _ = app.run_on_main_thread(move || close(&a));
    Ok(())
}

#[tauri::command]
pub fn mini_focus_main(app: AppHandle, window: tauri::Window) -> Result<(), String> {
    from(&window, MINI)?;
    // Kith's window gets focus, and that closes this one (main_focused).
    show_main(&app);
    Ok(())
}

/// The main window's focus changed.
pub fn main_focused(app: &AppHandle, focused: bool) {
    if focused {
        close(app);
    } else if RUNNING.load(Ordering::Relaxed) && !who::parent_edition(app) {
        show(app);
    }
}

fn show(app: &AppHandle) {
    if app.get_webview_window(MINI).is_some() {
        return;
    }
    let Some(server) = app.try_state::<State>().and_then(|s| s.guard().config.server.clone()) else { return };
    let Ok(url) = Url::parse(&format!("{server}/call-mini")) else { return };
    // Bottom right of the screen Kith is on, clear of the Dock.
    let (x, y) = app
        .get_webview_window(MAIN)
        .and_then(|w| w.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten())
        .map(|m| {
            let s = m.scale_factor();
            let area = m.work_area();
            let (ax, ay) = (area.position.x as f64 / s, area.position.y as f64 / s);
            let (aw, ah) = (area.size.width as f64 / s, area.size.height as f64 / s);
            (ax + aw - WIDTH - 24.0, ay + ah - HEIGHT - 24.0)
        })
        .unwrap_or((40.0, 40.0));
    let nav_server = server.clone();
    let built = WebviewWindowBuilder::new(app, MINI, WebviewUrl::External(url))
        .title(format!("{} call", who::name_for(app, who::Role::Child)))
        .initialization_script(format!("window.__KITH_APP__ = {:?};", who::hint(app)))
        .inner_size(WIDTH, HEIGHT)
        .position(x, y)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .shadow(true)
        // Don't take the keyboard from the app she's using; a first click still works.
        .focused(false)
        .accept_first_mouse(true)
        .background_color(tauri::window::Color(0x1a, 0x10, 0x17, 0xff))
        .on_navigation(move |u| same_origin(u, &nav_server) && u.path() == "/call-mini")
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .build();
    match built {
        Ok(w) => {
            round_corners(&w);
            let _ = app.emit_to(MAIN, "kith:mini-shown", true);
        }
        Err(e) => eprintln!("[kith] couldn't open the mini call: {e}"),
    }
}

fn close(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MINI) {
        let _ = w.destroy();
        let _ = app.emit_to(MAIN, "kith:mini-shown", false);
    }
}

/// Rounded corners without a title bar: the window itself is clear and its content is clipped to a
/// rounded rectangle (plain AppKit, no private API).
#[cfg(target_os = "macos")]
fn round_corners(w: &tauri::WebviewWindow) {
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    let Ok(ns) = w.ns_window() else { return };
    let ns = ns as *mut AnyObject;
    if ns.is_null() {
        return;
    }
    // SAFETY: `ns` is this window's live NSWindow, and this runs on the main thread (window events
    // and commands that build windows are handled there).
    unsafe {
        let clear: *mut AnyObject = msg_send![class!(NSColor), clearColor];
        let _: () = msg_send![ns, setOpaque: false];
        let _: () = msg_send![ns, setBackgroundColor: clear];
        let view: *mut AnyObject = msg_send![ns, contentView];
        if view.is_null() {
            return;
        }
        let _: () = msg_send![view, setWantsLayer: true];
        let layer: *mut AnyObject = msg_send![view, layer];
        if !layer.is_null() {
            let _: () = msg_send![layer, setCornerRadius: 18.0_f64];
            let _: () = msg_send![layer, setMasksToBounds: true];
        }
        let _: () = msg_send![ns, invalidateShadow];
    }
}

#[cfg(not(target_os = "macos"))]
fn round_corners(_w: &tauri::WebviewWindow) {}
