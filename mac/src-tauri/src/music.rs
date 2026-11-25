// Pip listens along (Kith, the child's app only): whether Apple Music or Spotify is playing.
//
// - Asked only while Kith's window is open, every 5 seconds (every 15 once nothing has played for
//   a couple of minutes), and only of an app that's already running: Kith checks the running apps
//   first, and the script itself checks again, so it never opens Music or Spotify.
// - The question goes by Apple Events (osascript). macOS asks her once per app whether Kith may
//   (Info.plist's NSAppleEventsUsageDescription). If she says no, Kith stops asking that app for
//   the rest of the run and Pip just doesn't react.
// - What goes to the page ("kith:music"): playing or not. The song's title and artist only while
//   she has switched on "Let Pip know what song is playing" (off to start with), and they're not
//   even asked for otherwise.

use crate::LockExt;
use serde::Serialize;
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

const PLAYERS: &[(&str, &str)] = &[("com.apple.Music", "Apple Music"), ("com.spotify.client", "Spotify")];
const QUICK: Duration = Duration::from_secs(5);
const RESTING: Duration = Duration::from_secs(15);
/// Nothing played for this long: ask less often.
const QUIET_AFTER: Duration = Duration::from_secs(120);

#[derive(Clone, Default, PartialEq, Eq, Serialize, Debug)]
pub struct Now {
    pub playing: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artist: Option<String>,
}

#[derive(Default)]
pub struct Music {
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    started: bool,
    songs: bool,
    now: Now,
    /// Players she said no to (this run): never asked again.
    denied: Vec<&'static str>,
}

/// The AppleScript for one player. With `songs` off it asks only whether it's playing.
pub fn script(bundle: &str, songs: bool) -> String {
    let what = if songs { r#""playing" & linefeed & (name of current track) & linefeed & (artist of current track)"# } else { r#""playing""# };
    format!(
        r#"if application id "{bundle}" is running then
  tell application id "{bundle}"
    if player state is playing then return {what}
  end tell
end if
return "stopped""#
    )
}

/// What osascript said, made into what the page is told. Titles and artists are trimmed and kept
/// short, and only kept when `songs` is on.
pub fn parse(out: &str, songs: bool) -> Now {
    let mut lines = out.lines();
    if lines.next().map(str::trim) != Some("playing") {
        return Now::default();
    }
    let clip = |s: Option<&str>| s.map(|s| s.trim().chars().take(120).collect::<String>()).filter(|s| !s.is_empty() && s != "missing value");
    if !songs {
        return Now { playing: true, title: None, artist: None };
    }
    Now { playing: true, title: clip(lines.next()), artist: clip(lines.next()) }
}

/// macOS's "not allowed to send Apple events" (she said no, or it's switched off in Settings).
pub fn refused(stderr: &str) -> bool {
    stderr.contains("-1743") || stderr.contains("-10004")
}

pub fn next_wait(last_played: Option<Instant>, now: Instant) -> Duration {
    match last_played {
        Some(t) if now.duration_since(t) < QUIET_AFTER => QUICK,
        _ => RESTING,
    }
}

#[cfg(target_os = "macos")]
fn running(bundle: &str) -> bool {
    use objc2_app_kit::NSRunningApplication;
    use objc2_foundation::NSString;
    !NSRunningApplication::runningApplicationsWithBundleIdentifier(&NSString::from_str(bundle)).is_empty()
}

#[cfg(not(target_os = "macos"))]
fn running(_bundle: &str) -> bool {
    false
}

enum Asked {
    Now(Now),
    Refused,
    Unknown,
}

fn ask(bundle: &str, songs: bool) -> Asked {
    let out = match Command::new("/usr/bin/osascript").arg("-e").arg(script(bundle, songs)).output() {
        Ok(o) => o,
        Err(_) => return Asked::Unknown,
    };
    if out.status.success() {
        return Asked::Now(parse(&String::from_utf8_lossy(&out.stdout), songs));
    }
    if refused(&String::from_utf8_lossy(&out.stderr)) {
        Asked::Refused
    } else {
        Asked::Unknown
    }
}

/// Kith's window is on screen (not hidden, not in the Dock).
fn open(app: &AppHandle) -> bool {
    app.get_webview_window(crate::MAIN).is_some_and(|w| w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false))
}

fn tell(app: &AppHandle, now: Now) {
    let Some(m) = app.try_state::<Music>() else { return };
    let changed = {
        let mut i = m.inner.guard();
        let changed = i.now != now;
        i.now = now.clone();
        changed
    };
    if changed {
        let _ = app.emit_to(crate::MAIN, "kith:music", now);
    }
}

fn watch(app: AppHandle) {
    let mut last_played: Option<Instant> = None;
    loop {
        if !open(&app) {
            tell(&app, Now::default());
            std::thread::sleep(QUICK);
            continue;
        }
        let Some(m) = app.try_state::<Music>() else { return };
        let (songs, denied) = {
            let i = m.inner.guard();
            (i.songs, i.denied.clone())
        };
        let mut now = Now::default();
        for (bundle, _) in PLAYERS {
            if denied.contains(bundle) || !running(bundle) {
                continue;
            }
            match ask(bundle, songs) {
                Asked::Now(n) if n.playing => {
                    now = n;
                    break;
                }
                Asked::Refused => m.inner.guard().denied.push(bundle),
                _ => {}
            }
        }
        if now.playing {
            last_played = Some(Instant::now());
        }
        tell(&app, now);
        std::thread::sleep(next_wait(last_played, Instant::now()));
    }
}

/// The page says it's listening (and whether she lets Pip know the song). Starts watching the
/// first time; returns what's playing now.
#[tauri::command]
pub fn music_watch(app: AppHandle, state: tauri::State<'_, Music>, songs: bool) -> Result<Now, String> {
    if crate::who::parent_edition(&app) {
        return Err("Only in Kith.".into());
    }
    let mut i = state.inner.guard();
    if i.songs != songs {
        i.songs = songs;
        // Song names switched off: forget the one we had straight away.
        if !songs {
            i.now.title = None;
            i.now.artist = None;
        }
    }
    if !i.started {
        i.started = true;
        std::thread::spawn(move || watch(app));
    }
    Ok(i.now.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn never_opens_the_player_and_only_asks_for_the_song_when_allowed() {
        let s = script("com.apple.Music", false);
        assert!(s.starts_with(r#"if application id "com.apple.Music" is running then"#));
        assert!(!s.contains("current track"));
        assert!(script("com.spotify.client", true).contains("name of current track"));
    }

    #[test]
    fn reads_what_osascript_says() {
        assert_eq!(parse("stopped\n", true), Now::default());
        assert_eq!(parse("", false), Now::default());
        assert_eq!(parse("playing\n", false), Now { playing: true, title: None, artist: None });
        // Titles only when she allows it, even if they came back.
        assert_eq!(parse("playing\nSong\nBand\n", false), Now { playing: true, title: None, artist: None });
        assert_eq!(parse("playing\n Song \nBand\n", true), Now { playing: true, title: Some("Song".into()), artist: Some("Band".into()) });
        assert_eq!(parse("playing\nmissing value\n\n", true), Now { playing: true, title: None, artist: None });
        assert_eq!(parse(&format!("playing\n{}\nx", "a".repeat(500)), true).title.unwrap().len(), 120);
    }

    #[test]
    fn a_no_from_her_is_recognised() {
        assert!(refused("execution error: Not authorised to send Apple events to Music. (-1743)"));
        assert!(!refused("execution error: Music got an error: Can't get current track. (-1728)"));
    }

    #[test]
    fn asks_less_often_when_nothing_has_played_for_a_while() {
        let now = Instant::now();
        assert_eq!(next_wait(None, now), RESTING);
        assert_eq!(next_wait(Some(now), now), QUICK);
        assert_eq!(next_wait(now.checked_sub(Duration::from_secs(300)), now), RESTING);
    }
}
