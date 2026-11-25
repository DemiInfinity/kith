// Mac notifications, for the child's (who.rs, and native.rs for the page) and the parent's (who.rs).
//
// A page that went wrong, or a burst on the server, mustn't flood the screen: the first few in a
// minute show as they are; the rest are gathered into one "N more" notification a few seconds
// later (at most one of those a minute), so nothing is silently dropped.

use crate::{LockExt, State};
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
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
    /// The child's inbox, as each of its two readers has passed it on (see `show_inbox`).
    inbox: Inbox,
}

/// Who read the child's inbox: the app's own background thread (who.rs, works with the window
/// closed), or Kith's page while it's open (client/src/lib/native.ts → native_notify).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Via {
    App,
    Page,
}

/// How long a notification from one reader waits to be matched by the other's.
const MATCH_FOR: Duration = Duration::from_secs(15 * 60);

/// Both readers go through the same inbox in the same order, so each notification reaches here
/// once from each (or once, if only one of them is running). Counting how many times each reader
/// has passed on the same words tells a repeat from a new one: it shows when this reader is ahead
/// of the other, and two real notifications with the same words still both show.
#[derive(Default)]
pub struct Inbox {
    seen: HashMap<u64, (u32, u32, Instant)>,
}

impl Inbox {
    /// Whether to show it: true the first time these words arrive, false for the other reader's copy.
    pub fn first(&mut self, via: Via, title: &str, body: &str, now: Instant) -> bool {
        self.seen.retain(|_, e| now.duration_since(e.2) < MATCH_FOR);
        let mut h = DefaultHasher::new();
        (title, body).hash(&mut h);
        let e = self.seen.entry(h.finish()).or_insert((0, 0, now));
        e.2 = now;
        let (mine, theirs) = if via == Via::App { (&mut e.0, e.1) } else { (&mut e.1, e.0) };
        *mine += 1;
        *mine > theirs
    }
}

/// A notification from the child's inbox, from either reader, shown once.
pub fn show_inbox(app: &AppHandle, via: Via, title: &str, body: &str) {
    let Some(state) = app.try_state::<State>() else { return };
    let new = state.guard().notes.inbox.first(via, title, body, Instant::now());
    if new {
        show(app, title, body, false);
    }
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

#[cfg(test)]
mod tests {
    use super::{Inbox, Via, MATCH_FOR};
    use std::time::Instant;

    #[test]
    fn each_notification_shows_once_whichever_reader_brings_it_first() {
        let mut i = Inbox::default();
        let t = Instant::now();
        assert!(i.first(Via::App, "Pip", "Time for a break?", t));
        assert!(!i.first(Via::Page, "Pip", "Time for a break?", t));
        assert!(i.first(Via::Page, "Pip", "Homework at 5", t));
        assert!(!i.first(Via::App, "Pip", "Homework at 5", t));
    }

    #[test]
    fn the_same_words_twice_are_two_notifications() {
        let mut i = Inbox::default();
        let t = Instant::now();
        assert!(i.first(Via::App, "Pip", "Drink some water", t));
        assert!(i.first(Via::App, "Pip", "Drink some water", t));
        assert!(!i.first(Via::Page, "Pip", "Drink some water", t));
        assert!(!i.first(Via::Page, "Pip", "Drink some water", t));
        // Only one reader running (the window closed): every one shows.
        assert!(i.first(Via::App, "Pip", "Drink some water", t));
    }

    #[test]
    fn an_unmatched_one_is_forgotten_after_a_while() {
        let mut i = Inbox::default();
        let t = Instant::now();
        assert!(i.first(Via::App, "Pip", "Hi", t));
        assert!(i.first(Via::Page, "Pip", "Hi", t + MATCH_FOR + std::time::Duration::from_secs(1)));
    }
}
