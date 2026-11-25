// What Kith's own pages (on the configured server, and nowhere else) can ask the Mac to do.
// See capability_for_server() in main.rs: these commands are the only ones that origin may call.
//
// - native_info: what this app can do and what's switched on.
// - native_notify: show a Mac notification (Pip's check-ins and reminders).
// - native_calendar_snapshot: the coming week from Calendar and Reminders, only while she has
//   switched on Kith › Share Calendar & Reminders with Pip.
// - native_add_event / native_add_reminder: Pip asked to add something. A native prompt asks her
//   first, every time; the page can't skip it.
// - native_pick_document: she picks a document to show Pip (text only; see files.rs).

use crate::eventkit::{self, Access, Event, NewEvent, NewReminder, Reminder};
use crate::files::{self, SharedFile};
use crate::State;
use chrono::{Local, TimeZone};
use serde::Serialize;
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_notification::NotificationExt;

pub const CALL_SHORTCUT: &str = "Control+Alt+Space";
pub const CALL_SHORTCUT_LABEL: &str = "⌃⌥Space";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    app: &'static str,
    version: &'static str,
    share_calendar: bool,
    calendar: Access,
    reminders: Access,
    call_shortcut: &'static str,
    file_kinds: &'static [&'static str],
}

#[tauri::command]
pub fn native_info(state: tauri::State<'_, State>) -> Info {
    Info {
        app: "kith-mac",
        version: env!("CARGO_PKG_VERSION"),
        share_calendar: state.lock().unwrap().config.share_calendar,
        calendar: eventkit::access(eventkit::EVENT),
        reminders: eventkit::access(eventkit::REMINDER),
        call_shortcut: CALL_SHORTCUT_LABEL,
        file_kinds: files::KINDS,
    }
}

#[tauri::command]
pub fn native_notify(app: AppHandle, state: tauri::State<'_, State>, title: String, body: String) -> Result<(), String> {
    {
        // A page that went wrong mustn't flood her with notifications: 6 a minute at most.
        let mut s = state.lock().unwrap();
        s.notify_times.retain(|t| t.elapsed() < Duration::from_secs(60));
        if s.notify_times.len() >= 6 {
            return Err("too many".into());
        }
        s.notify_times.push(Instant::now());
    }
    app.notification()
        .builder()
        .title(eventkit::clip(&title, 80))
        .body(eventkit::clip(&body, 300))
        .show()
        .map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct Snapshot {
    events: Vec<Event>,
    reminders: Vec<Reminder>,
}

/// The next 7 days, or nothing while sharing is off.
#[tauri::command]
pub async fn native_calendar_snapshot(state: tauri::State<'_, State>) -> Result<Option<Snapshot>, String> {
    if !state.lock().unwrap().config.share_calendar {
        return Ok(None);
    }
    tauri::async_runtime::spawn_blocking(|| {
        let now = Local::now().timestamp_millis();
        Snapshot { events: eventkit::events(now - 3_600_000, now + 7 * 86_400_000), reminders: eventkit::reminders() }
    })
    .await
    .map(Some)
    .map_err(|e| e.to_string())
}

fn when(ms: i64, all_day: bool) -> String {
    match Local.timestamp_millis_opt(ms).single() {
        Some(t) if all_day => t.format("%A %-d %B").to_string(),
        Some(t) => t.format("%A %-d %B at %H:%M").to_string(),
        None => "an unknown time".into(),
    }
}

/// Asks her, natively. `true` = she said yes.
fn ask(app: &AppHandle, text: String) -> bool {
    app.dialog()
        .message(text)
        .title("Pip would like to add this")
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom("Add".into(), "Not now".into()))
        .blocking_show()
}

/// `Ok(true)` added, `Ok(false)` she said not now.
#[tauri::command]
pub async fn native_add_event(app: AppHandle, state: tauri::State<'_, State>, event: NewEvent) -> Result<bool, String> {
    if !state.lock().unwrap().config.share_calendar {
        return Err("Calendar sharing is off.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let text = format!("“{}”, {}, to your calendar.", eventkit::clip(&event.title, 120), when(event.start, event.all_day));
        if !ask(&app, text) {
            return Ok(false);
        }
        eventkit::add_event(&event).map(|_| true)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn native_add_reminder(app: AppHandle, state: tauri::State<'_, State>, reminder: NewReminder) -> Result<bool, String> {
    if !state.lock().unwrap().config.share_calendar {
        return Err("Reminders sharing is off.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let due = reminder.due.map(|d| format!(", due {}", when(d, false))).unwrap_or_default();
        let text = format!("“{}”{} to your reminders.", eventkit::clip(&reminder.title, 120), due);
        if !ask(&app, text) {
            return Ok(false);
        }
        eventkit::add_reminder(&reminder).map(|_| true)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// `Ok(None)` if she cancelled.
#[tauri::command]
pub async fn native_pick_document(app: AppHandle) -> Result<Option<SharedFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let picked = app.dialog().file().set_title("Show Pip a document").add_filter("Documents", files::KINDS).blocking_pick_file();
        match picked.and_then(|p| p.into_path().ok()) {
            Some(path) => files::read_document(&path).map(Some),
            None => Ok(None),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
