// Calendar and Reminders on this Mac, through Apple's EventKit.
//
// Only used when the child has switched on Kith › Share Calendar & Reminders with Pip. macOS asks
// her the first time. Reading gives Pip a short summary of the coming week; adding always goes
// through a native "Add / Not now" prompt first (see native.rs).

use serde::{Deserialize, Serialize};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub title: String,
    /// Milliseconds since 1970 (UTC).
    pub start: i64,
    pub end: i64,
    pub all_day: bool,
    pub calendar: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Reminder {
    pub title: String,
    /// Milliseconds since 1970 (UTC), if it has a due date.
    pub due: Option<i64>,
    pub list: String,
}

#[derive(Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Access {
    NotAsked,
    Allowed,
    Denied,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewEvent {
    pub title: String,
    pub start: i64,
    pub end: Option<i64>,
    #[serde(default)]
    pub all_day: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewReminder {
    pub title: String,
    pub due: Option<i64>,
}

const MAX_ITEMS: usize = 60;

pub fn clip(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

#[cfg(target_os = "macos")]
mod imp {
    use super::*;
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::Bool;
    use objc2::AllocAnyThread;
    use objc2_event_kit::{EKAuthorizationStatus, EKEntityType, EKEvent, EKEventStore, EKReminder, EKSpan};
    use objc2_foundation::{NSArray, NSCalendar, NSCalendarUnit, NSDate, NSError, NSString};
    use std::sync::mpsc;
    use std::time::Duration;

    fn store() -> Retained<EKEventStore> {
        unsafe { EKEventStore::init(EKEventStore::alloc()) }
    }

    fn date(ms: i64) -> Retained<NSDate> {
        NSDate::dateWithTimeIntervalSince1970(ms as f64 / 1000.0)
    }

    fn ms(d: &NSDate) -> i64 {
        (d.timeIntervalSince1970() * 1000.0) as i64
    }

    pub fn access(kind: EKEntityType) -> Access {
        let s = unsafe { EKEventStore::authorizationStatusForEntityType(kind) };
        if s == EKAuthorizationStatus::FullAccess {
            Access::Allowed
        } else if s == EKAuthorizationStatus::NotDetermined {
            Access::NotAsked
        } else {
            Access::Denied
        }
    }

    /// Shows macOS's own permission prompt (once). Waits up to two minutes for her answer.
    pub fn request(kind: EKEntityType) -> Access {
        if access(kind) != Access::NotAsked {
            return access(kind);
        }
        let (tx, rx) = mpsc::channel::<bool>();
        let tx = std::sync::Mutex::new(tx);
        let block = RcBlock::new(move |granted: Bool, _err: *mut NSError| {
            let _ = tx.lock().map(|t| t.send(granted.as_bool()));
        });
        let st = store();
        unsafe {
            let ptr = &*block as *const block2::DynBlock<dyn Fn(Bool, *mut NSError)> as *mut _;
            if kind == EKEntityType::Event {
                st.requestFullAccessToEventsWithCompletion(ptr);
            } else {
                st.requestFullAccessToRemindersWithCompletion(ptr);
            }
        }
        match rx.recv_timeout(Duration::from_secs(120)) {
            Ok(true) => Access::Allowed,
            Ok(false) => Access::Denied,
            Err(_) => access(kind),
        }
    }

    pub fn events(from: i64, to: i64) -> Vec<Event> {
        if access(EKEntityType::Event) != Access::Allowed {
            return vec![];
        }
        let st = store();
        let mut out: Vec<Event> = unsafe {
            let pred = st.predicateForEventsWithStartDate_endDate_calendars(&date(from), &date(to), None);
            let found: Retained<NSArray<EKEvent>> = st.eventsMatchingPredicate(&pred);
            found
                .iter()
                .map(|e| Event {
                    title: clip(&e.title().to_string(), 200),
                    start: ms(&e.startDate()),
                    end: ms(&e.endDate()),
                    all_day: e.isAllDay(),
                    calendar: e.calendar().map(|c| clip(&c.title().to_string(), 80)).unwrap_or_default(),
                })
                .collect()
        };
        out.sort_by_key(|e| e.start);
        out.truncate(MAX_ITEMS);
        out
    }

    pub fn reminders() -> Vec<Reminder> {
        if access(EKEntityType::Reminder) != Access::Allowed {
            return vec![];
        }
        let st = store();
        let (tx, rx) = mpsc::channel::<Vec<Reminder>>();
        let tx = std::sync::Mutex::new(tx);
        let block = RcBlock::new(move |found: *mut NSArray<EKReminder>| {
            let mut out = vec![];
            if let Some(found) = unsafe { found.as_ref() } {
                let cal = NSCalendar::currentCalendar();
                for r in found.iter() {
                    unsafe {
                        let due = r.dueDateComponents().and_then(|c| cal.dateFromComponents(&c)).map(|d| ms(&d));
                        out.push(Reminder {
                            title: clip(&r.title().to_string(), 200),
                            due,
                            list: r.calendar().map(|c| clip(&c.title().to_string(), 80)).unwrap_or_default(),
                        });
                    }
                }
            }
            let _ = tx.lock().map(|t| t.send(out));
        });
        unsafe {
            let pred = st.predicateForIncompleteRemindersWithDueDateStarting_ending_calendars(None, None, None);
            let _ = st.fetchRemindersMatchingPredicate_completion(&pred, &block);
        }
        let mut out = rx.recv_timeout(Duration::from_secs(20)).unwrap_or_default();
        out.sort_by_key(|r| r.due.unwrap_or(i64::MAX));
        out.truncate(MAX_ITEMS);
        out
    }

    pub fn add_event(e: &NewEvent) -> Result<(), String> {
        if request(EKEntityType::Event) != Access::Allowed {
            return Err("Kith isn't allowed to use Calendar. Turn it on in System Settings › Privacy & Security › Calendars.".into());
        }
        let st = store();
        unsafe {
            let ev = EKEvent::eventWithEventStore(&st);
            ev.setTitle(Some(&NSString::from_str(&clip(&e.title, 200))));
            ev.setStartDate(Some(&date(e.start)));
            let end = e.end.filter(|end| *end > e.start).unwrap_or(e.start + if e.all_day { 86_400_000 } else { 3_600_000 });
            ev.setEndDate(Some(&date(end)));
            ev.setAllDay(e.all_day);
            let cal = st.defaultCalendarForNewEvents().ok_or("There's no calendar to add to on this Mac.")?;
            ev.setCalendar(Some(&cal));
            st.saveEvent_span_error(&ev, EKSpan::ThisEvent).map_err(|err| err.localizedDescription().to_string())
        }
    }

    pub fn add_reminder(r: &NewReminder) -> Result<(), String> {
        if request(EKEntityType::Reminder) != Access::Allowed {
            return Err("Kith isn't allowed to use Reminders. Turn it on in System Settings › Privacy & Security › Reminders.".into());
        }
        let st = store();
        unsafe {
            let rem = EKReminder::reminderWithEventStore(&st);
            rem.setTitle(Some(&NSString::from_str(&clip(&r.title, 200))));
            if let Some(due) = r.due {
                let cal = NSCalendar::currentCalendar();
                let units = NSCalendarUnit::Year | NSCalendarUnit::Month | NSCalendarUnit::Day | NSCalendarUnit::Hour | NSCalendarUnit::Minute;
                let comps = cal.components_fromDate(units, &date(due));
                rem.setDueDateComponents(Some(&comps));
            }
            let list = st.defaultCalendarForNewReminders().ok_or("There's no Reminders list to add to on this Mac.")?;
            rem.setCalendar(Some(&list));
            st.saveReminder_commit_error(&rem, true).map_err(|err| err.localizedDescription().to_string())
        }
    }

    pub const EVENT: EKEntityType = EKEntityType::Event;
    pub const REMINDER: EKEntityType = EKEntityType::Reminder;
}

#[cfg(target_os = "macos")]
pub use imp::*;
