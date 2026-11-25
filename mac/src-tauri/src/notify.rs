// Mac notifications, for the child's (native.rs) and the parent's (who.rs).
//
// A page that went wrong, or a burst on the server, mustn't flood the screen: the first few in a
// minute show as they are; the rest are gathered into one "N more" notification a few seconds
// later (at most one of those a minute), so nothing is silently dropped.

use crate::{LockExt, State};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

/// Shown as they come, per minute.
const BURST: usize = 5;
/// How long to gather the rest before the summary.
const GATHER: Duration = Duration::from_secs(5);
const MINUTE: Duration = Duration::from_secs(60);

#[derive(Default)]
pub struct Notes {
    times: Vec<Instant>,
    held: u32,
    held_urgent: bool,
    flushing: bool,
    last_summary: Option<Instant>,
}

fn display(app: &AppHandle, title: &str, body: &str, urgent: bool) {
    let mut b = app.notification().builder().title(crate::eventkit::clip(title, 80)).body(crate::eventkit::clip(body, 300));
    if urgent {
        b = b.sound("Glass");
    }
    let _ = b.show();
}

pub fn show(app: &AppHandle, title: &str, body: &str, urgent: bool) {
    let Some(state) = app.try_state::<State>() else { return };
    let mut s = state.guard();
    let n = &mut s.notes;
    n.times.retain(|t| t.elapsed() < MINUTE);
    if n.times.len() < BURST {
        n.times.push(Instant::now());
        drop(s);
        display(app, title, body, urgent);
        return;
    }
    n.held += 1;
    n.held_urgent |= urgent;
    if n.flushing {
        return;
    }
    n.flushing = true;
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(GATHER);
        let Some(state) = app.try_state::<State>() else { return };
        // One summary a minute at most.
        loop {
            let wait = state.guard().notes.last_summary.map(|t| MINUTE.saturating_sub(t.elapsed())).unwrap_or_default();
            if wait.is_zero() {
                break;
            }
            std::thread::sleep(wait);
        }
        let (count, urgent) = {
            let mut s = state.guard();
            let n = &mut s.notes;
            n.flushing = false;
            n.last_summary = Some(Instant::now());
            (std::mem::take(&mut n.held), std::mem::take(&mut n.held_urgent))
        };
        if count > 0 {
            let name = crate::who::name_for(&app, crate::who::Role::SignedOut);
            let body = if count == 1 { format!("1 more notification. Open {name} to see it.") } else { format!("{count} more notifications. Open {name} to see them.") };
            display(&app, name, &body, urgent);
        }
    });
}
