// What Kith's own pages (on the configured server, and nowhere else) can ask the Mac to do.
// See capability_for_server() in main.rs: these commands are the only ones that origin may call.
//
// - native_info: what this app can do and what's switched on.
// - native_notify: show a Mac notification from the child's inbox (Pip's check-ins and reminders).
//   The app reads the same inbox itself (who.rs), so a notification both bring shows once. A burst
//   is gathered into one "N more" notification (notify.rs), never dropped.
// - native_calendar_snapshot: the coming week from the calendars and reminder lists she has chosen
//   (reminders due in the next 7 days), only while she has switched on Kith › Share Calendar &
//   Reminders with Pip.
// - native_add_event / native_add_reminder: Pip asked to add something. A native prompt asks her
//   first, every time; the page can't skip it.
// - native_pick_document: she picks a document to show Pip (text only; see files.rs).

use crate::eventkit::{self, Access, Event, NewEvent, NewReminder, Reminder};
use crate::files::{self, SharedFile};
use crate::{LockExt, State};
use chrono::{Local, TimeZone};
use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

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
        share_calendar: state.guard().config.share_calendar,
        calendar: eventkit::access(eventkit::EVENT),
        reminders: eventkit::access(eventkit::REMINDER),
        call_shortcut: CALL_SHORTCUT_LABEL,
        file_kinds: files::KINDS,
    }
}

#[tauri::command]
pub fn native_notify(app: AppHandle, title: String, body: String) {
    // The page reads the child's inbox while it's open; the app reads it too (who.rs), so each one
    // shows once, from whichever gets there first.
    crate::notify::show_inbox(&app, crate::notify::Via::Page, &title, &body);
}

#[derive(Serialize)]
pub struct Snapshot {
    events: Vec<Event>,
    reminders: Vec<Reminder>,
}

/// The next 7 days from what she's chosen to share, or nothing while sharing is off.
#[tauri::command]
pub async fn native_calendar_snapshot(state: tauri::State<'_, State>) -> Result<Option<Snapshot>, String> {
    let (on, cals, lists) = {
        let s = state.guard();
        (s.config.share_calendar, s.config.share_calendars.clone(), s.config.share_lists.clone())
    };
    if !on {
        return Ok(None);
    }
    tauri::async_runtime::spawn_blocking(move || {
        let now = Local::now();
        let week = now.timestamp_millis() + eventkit::REMINDER_DAYS * 86_400_000;
        // Reminders from the start of today, so today's (even if the time has passed) are there.
        let today = now.date_naive().and_hms_opt(0, 0, 0).and_then(|d| Local.from_local_datetime(&d).earliest()).map_or(now.timestamp_millis(), |d| d.timestamp_millis());
        Snapshot { events: eventkit::events(now.timestamp_millis() - 3_600_000, week, &cals), reminders: eventkit::reminders(today, week, &lists) }
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
    if !state.guard().config.share_calendar {
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
    if !state.guard().config.share_calendar {
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
