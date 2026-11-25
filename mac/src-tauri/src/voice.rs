// Pip's voice on this Mac (Kith, the child's app; never Kith Parent): Kokoro-82M, run here, so
// calls don't wait for the home server to speak.
//
// - The model isn't in the app. The first time it's wanted (a call, or the voice picker), it's
//   fetched from its public home on Hugging Face (onnx-community/Kokoro-82M-v1.0-ONNX, at a fixed
//   revision) into Application Support, and every file is checked against the SHA-256 written
//   here. Only huggingface.co is asked, and the only redirects followed are to Hugging Face's own
//   download servers (*.hf.co). Nothing else is sent: no cookie, no name, no text.
// - Until it's ready, or if anything goes wrong, the page uses the home voice as before.
// - Text in: Pip's reply, one sentence at a time, from the page. It never leaves the Mac.
// - Too slow to keep up (it takes longer to make a sentence than to say it, measured as it goes),
//   and it stands aside for the home voice. Intel Macs always use the home voice: ONNX Runtime has
//   no prebuilt library for them any more, and the Intel Mac mini at home managed only 0.76× real
//   time.
//
// The model and voices are Apache-2.0 (hexgrad/Kokoro-82M); see THIRD-PARTY-NOTICES.md.
#![cfg_attr(not(target_arch = "aarch64"), allow(dead_code))]

use crate::LockExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

/// The model's revision on Hugging Face: files at a commit can't change underneath us.
const REPO: &str = "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231";
const FOLDER: &str = "kokoro-v1.0";

struct Asset {
    path: &'static str,
    size: u64,
    sha256: &'static str,
}

const MODEL: Asset = Asset { path: "onnx/model.onnx", size: 325_532_232, sha256: "8fbea51ea711f2af382e88c833d9e288c6dc82ce5e98421ea61c058ce21a34cb" };

/// The British voices she can pick: id, name in the picker, file.
const VOICES: &[(&str, &str, Asset)] = &[
    ("bf_emma", "Emma", Asset { path: "voices/bf_emma.bin", size: 522_240, sha256: "669fe0647f9dd04fcab92f1439a40eeb4c8b4ab1f82e4996fe3d918ce4a63b73" }),
    ("bf_isabella", "Isabella", Asset { path: "voices/bf_isabella.bin", size: 522_240, sha256: "3754352c4aaa46d17f27654ab7518d65b62ad6163a0f55a5f4330c2da2c4e94f" }),
    ("bf_lily", "Lily", Asset { path: "voices/bf_lily.bin", size: 522_240, sha256: "5e0ee32ebe64a467124976b14e69590746f1c4ce41a12b587a50c862edfea335" }),
    ("bf_alice", "Alice", Asset { path: "voices/bf_alice.bin", size: 522_240, sha256: "08afa6ba24da61ea5e8efa139e5aadc938d83f0a6da5a900adaf763ac1da5573" }),
    ("bm_fable", "Fable", Asset { path: "voices/bm_fable.bin", size: 522_240, sha256: "f889083196807b4adb15e9204252165f503b8d33d3982e681c52443c49d798f1" }),
    ("bm_george", "George", Asset { path: "voices/bm_george.bin", size: 522_240, sha256: "c4b235a4c1f2cd3b939fed08b899ce9385638b763f7b73a59616c4fc9bd6c9bc" }),
];
const DEFAULT_VOICE: &str = "bf_emma";

/// Slower than this (seconds to make a second of speech), and she'd hear gaps: use the home voice.
const TOO_SLOW: f32 = 0.9;
/// Not used for this long: the model (a few hundred MB of memory) is put away until it's next
/// wanted. The files stay; loading it again takes a few seconds.
const PUT_AWAY_AFTER: Duration = Duration::from_secs(15 * 60);

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    /// Not fetched yet (nothing happens until it's wanted).
    Absent,
    Downloading,
    Loading,
    Ready,
    /// This Mac can't keep up: the home voice it is.
    Slow,
    /// The fetch or the model failed; asking again tries again.
    Failed,
    /// An Intel Mac, or Kith Parent.
    Unsupported,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    phase: Phase,
    /// 0 to 1, while downloading.
    progress: f32,
    /// Seconds taken per second of speech, once measured.
    rtf: Option<f32>,
    voices: Vec<VoiceInfo>,
}

#[derive(Clone, Serialize)]
pub struct VoiceInfo {
    id: &'static str,
    name: &'static str,
}

struct Live {
    phase: Phase,
    progress: f32,
    rtf: Option<f32>,
    /// Sentences timed since loading (the first few count more gently: the model warms up).
    timed: u32,
    /// When it last spoke (or loaded): after a quiet while the model is put away to free memory.
    used: Option<Instant>,
}

pub struct Voice {
    live: Mutex<Live>,
    #[cfg(target_arch = "aarch64")]
    engine: Mutex<Option<(crate::kokoro::Engine, std::collections::HashMap<String, Vec<f32>>)>>,
}

pub fn supported(app: &AppHandle) -> bool {
    cfg!(target_arch = "aarch64") && !crate::who::parent_edition(app)
}

impl Voice {
    pub fn new(app: &AppHandle) -> Voice {
        let phase = if supported(app) { Phase::Absent } else { Phase::Unsupported };
        Voice {
            live: Mutex::new(Live { phase, progress: 0.0, rtf: None, timed: 0, used: None }),
            #[cfg(target_arch = "aarch64")]
            engine: Mutex::new(None),
        }
    }

    fn status(&self) -> Status {
        let l = self.live.guard();
        Status {
            phase: l.phase,
            progress: l.progress,
            rtf: l.rtf,
            voices: if l.phase == Phase::Unsupported { vec![] } else { VOICES.iter().map(|(id, name, _)| VoiceInfo { id, name }).collect() },
        }
    }
}

fn set(app: &AppHandle, f: impl FnOnce(&mut Live)) {
    let Some(v) = app.try_state::<Voice>() else { return };
    f(&mut v.live.guard());
    let _ = app.emit_to(crate::MAIN, "kith:voice", v.status());
}

fn folder(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join(FOLDER))
}

fn local(dir: &Path, a: &Asset) -> PathBuf {
    dir.join(a.path)
}

/// Only Hugging Face: huggingface.co itself, and its own download servers it redirects to.
pub fn allowed(url: &str) -> bool {
    let Ok(u) = url::Url::parse(url) else { return false };
    if u.scheme() != "https" || u.port().is_some() || !u.username().is_empty() {
        return false;
    }
    match u.host() {
        Some(url::Host::Domain(h)) => {
            let h = h.to_ascii_lowercase();
            h == "huggingface.co" || (h.ends_with(".hf.co") && h.len() > ".hf.co".len())
        }
        _ => false,
    }
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// A file already here and checked (a `.ok` beside it says so), or here and right when checked now.
fn present(path: &Path, a: &Asset) -> bool {
    let ok = path.with_extension("ok");
    let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    if size != a.size {
        return false;
    }
    if std::fs::read_to_string(&ok).is_ok_and(|s| s.trim() == a.sha256) {
        return true;
    }
    let Ok(mut f) = std::fs::File::open(path) else { return false };
    let mut h = Sha256::new();
    if std::io::copy(&mut f, &mut h).is_err() || hex(&h.finalize()) != a.sha256 {
        return false;
    }
    std::fs::write(ok, a.sha256).is_ok()
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .max_redirects(0)
        .http_status_as_error(false)
        .https_only(true)
        .timeout_connect(Some(Duration::from_secs(20)))
        .timeout_recv_response(Some(Duration::from_secs(30)))
        .timeout_recv_body(Some(Duration::from_secs(60 * 60)))
        .user_agent("Kith")
        .build()
        .into()
}

/// Fetches one file into place, checking its size and SHA-256. Carries on from a part already
/// fetched. `seen` is called with the bytes of this file so far.
fn fetch(agent: &ureq::Agent, a: &Asset, dest: &Path, mut seen: impl FnMut(u64)) -> Result<(), String> {
    if let Some(dir) = dest.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let part = dest.with_extension("part");
    let mut h = Sha256::new();
    let mut have = std::fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
    if have >= a.size {
        let _ = std::fs::remove_file(&part);
        have = 0;
    }
    if have > 0 {
        let mut f = std::fs::File::open(&part).map_err(|e| e.to_string())?;
        std::io::copy(&mut (&mut f).take(have), &mut h).map_err(|e| e.to_string())?;
    }
    let mut url = format!("{REPO}/{}", a.path);
    let mut res = None;
    for _ in 0..5 {
        if !allowed(&url) {
            return Err("The voice download went somewhere it shouldn't.".into());
        }
        let mut req = agent.get(&url);
        if have > 0 {
            req = req.header("Range", &format!("bytes={have}-"));
        }
        let r = req.call().map_err(|e| e.to_string())?;
        if r.status().is_redirection() {
            let next = r.headers().get("location").and_then(|v| v.to_str().ok()).ok_or("A redirect with nowhere to go.")?;
            url = url::Url::parse(&url).and_then(|base| base.join(next)).map_err(|e| e.to_string())?.to_string();
            continue;
        }
        res = Some(r);
        break;
    }
    let res = res.ok_or("Too many redirects.")?;
    let status = res.status().as_u16();
    let mut out = match status {
        206 if have > 0 => std::fs::OpenOptions::new().append(true).open(&part).map_err(|e| e.to_string())?,
        200 => {
            // Starting again (the server didn't carry on from where we were).
            h = Sha256::new();
            have = 0;
            std::fs::File::create(&part).map_err(|e| e.to_string())?
        }
        s => return Err(format!("The voice download said {s}.")),
    };
    let mut body = res.into_body().into_reader();
    let mut buf = vec![0u8; 1 << 16];
    let mut last = Instant::now();
    loop {
        let n = body.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        have += n as u64;
        if have > a.size {
            let _ = std::fs::remove_file(&part);
            return Err("The voice file was bigger than it should be.".into());
        }
        h.update(&buf[..n]);
        out.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        if last.elapsed() > Duration::from_millis(250) {
            last = Instant::now();
            seen(have);
        }
    }
    out.sync_all().map_err(|e| e.to_string())?;
    drop(out);
    if have != a.size || hex(&h.finalize()) != a.sha256 {
        let _ = std::fs::remove_file(&part);
        return Err("The voice file didn't check out.".into());
    }
    std::fs::rename(&part, dest).map_err(|e| e.to_string())?;
    std::fs::write(dest.with_extension("ok"), a.sha256).map_err(|e| e.to_string())?;
    seen(a.size);
    Ok(())
}

/// Fetches whatever's missing, loads the model, and times it once.
fn prepare(app: &AppHandle) -> Result<(), String> {
    let dir = folder(app).ok_or("Can't find the app's folder.")?;
    let all: Vec<&Asset> = VOICES.iter().map(|(_, _, a)| a).chain(std::iter::once(&MODEL)).collect();
    let missing: Vec<&Asset> = all.iter().copied().filter(|a| !present(&local(&dir, a), a)).collect();
    if !missing.is_empty() {
        let total: u64 = missing.iter().map(|a| a.size).sum();
        let agent = agent();
        let mut done = 0u64;
        set(app, |l| {
            l.phase = Phase::Downloading;
            l.progress = 0.0;
        });
        for a in missing {
            let base = done;
            fetch(&agent, a, &local(&dir, a), |n| {
                let p = ((base + n) as f64 / total as f64) as f32;
                set(app, |l| l.progress = p.min(1.0));
            })?;
            done += a.size;
        }
    }
    set(app, |l| {
        l.phase = Phase::Loading;
        l.progress = 1.0;
    });
    load(app, &dir)
}

#[cfg(target_arch = "aarch64")]
fn load(app: &AppHandle, dir: &Path) -> Result<(), String> {
    let mut engine = crate::kokoro::Engine::load(&local(dir, &MODEL))?;
    let mut voices = std::collections::HashMap::new();
    for (id, _, a) in VOICES {
        let bytes = std::fs::read(local(dir, a)).map_err(|e| e.to_string())?;
        voices.insert(id.to_string(), crate::kokoro::read_voice(&bytes)?);
    }
    // Warm up, then time a sentence: a Mac that can't keep up uses the home voice.
    let v = &voices[DEFAULT_VOICE];
    engine.speak("Hello!", v, 1.0)?;
    let t = Instant::now();
    let samples = engine.speak("It's really lovely to hear from you today.", v, 1.0)?;
    let rtf = t.elapsed().as_secs_f32() / (samples.len().max(1) as f32 / crate::kokoro::SAMPLE_RATE as f32);
    let state = app.state::<Voice>();
    *state.engine.guard() = Some((engine, voices));
    let slow = rtf > TOO_SLOW;
    set(app, |l| {
        l.rtf = Some(rtf);
        l.timed = 0;
        l.used = Some(Instant::now());
        l.phase = if slow { Phase::Slow } else { Phase::Ready };
    });
    if slow {
        // It won't be used: don't keep it in memory.
        *state.engine.guard() = None;
    } else {
        let a = app.clone();
        std::thread::spawn(move || put_away_when_quiet(&a));
    }
    Ok(())
}

/// Puts the model away after a quiet while (it comes back with the next call).
#[cfg(target_arch = "aarch64")]
fn put_away_when_quiet(app: &AppHandle) {
    loop {
        std::thread::sleep(Duration::from_secs(60));
        let state = app.state::<Voice>();
        let quiet = {
            let l = state.live.guard();
            l.phase == Phase::Ready && l.used.is_some_and(|t| t.elapsed() > PUT_AWAY_AFTER)
        };
        if quiet {
            // Holding the engine lock: a sentence being made finishes first.
            let mut engine = state.engine.guard();
            *engine = None;
            drop(engine);
            set(app, |l| l.phase = Phase::Absent);
            return;
        }
    }
}

#[cfg(not(target_arch = "aarch64"))]
fn load(_app: &AppHandle, _dir: &Path) -> Result<(), String> {
    Err("Not on this Mac.".into())
}

/// The running average after one more sentence, and whether it's now too slow to use. A single
/// slow sentence (the Mac busy for a moment) doesn't switch it off; a steady run of them does.
pub fn after_sentence(avg: Option<f32>, timed: u32, rtf: f32) -> (f32, bool) {
    let next = match avg {
        Some(a) => a * 0.7 + rtf * 0.3,
        None => rtf,
    };
    (next, timed >= 3 && next > TOO_SLOW)
}

#[tauri::command]
pub fn voice_status(state: tauri::State<'_, Voice>) -> Status {
    state.status()
}

/// Gets the voice ready (fetching it the first time). Returns straight away; "kith:voice" events
/// say how it's going.
#[tauri::command]
pub fn voice_prepare(app: AppHandle, state: tauri::State<'_, Voice>) -> Status {
    {
        let mut l = state.live.guard();
        // Already on its way, ready, or not for this Mac.
        if !matches!(l.phase, Phase::Absent | Phase::Failed) {
            drop(l);
            return state.status();
        }
        l.phase = Phase::Loading;
    }
    let a = app.clone();
    std::thread::spawn(move || {
        if let Err(e) = prepare(&a) {
            eprintln!("[kith] Pip's voice isn't ready: {e}");
            set(&a, |l| l.phase = Phase::Failed);
        }
    });
    state.status()
}

/// One sentence of Pip's reply, as a WAV. Fails (and the page uses the home voice) unless ready.
#[tauri::command]
pub async fn voice_speak(app: AppHandle, text: String, voice: String) -> Result<tauri::ipc::Response, String> {
    let text: String = text.chars().take(1000).collect();
    tauri::async_runtime::spawn_blocking(move || speak(&app, &text, &voice)).await.map_err(|e| e.to_string())?.map(tauri::ipc::Response::new)
}

#[cfg(target_arch = "aarch64")]
fn speak(app: &AppHandle, text: &str, voice: &str) -> Result<Vec<u8>, String> {
    let state = app.state::<Voice>();
    if state.live.guard().phase != Phase::Ready {
        return Err("not-ready".into());
    }
    let mut guard = state.engine.guard();
    let (engine, voices) = guard.as_mut().ok_or("not-ready")?;
    let v = voices.get(voice).or_else(|| voices.get(DEFAULT_VOICE)).ok_or("not-ready")?;
    let t = Instant::now();
    let samples = engine.speak(text, v, 1.0)?;
    drop(guard);
    let secs = samples.len() as f32 / crate::kokoro::SAMPLE_RATE as f32;
    if secs > 0.5 {
        let rtf = t.elapsed().as_secs_f32() / secs;
        set(app, |l| {
            let (avg, slow) = after_sentence(l.rtf, l.timed, rtf);
            l.rtf = Some(avg);
            l.timed += 1;
            l.used = Some(Instant::now());
            if slow {
                l.phase = Phase::Slow;
            }
        });
    }
    Ok(crate::kokoro::wav(&samples))
}

#[cfg(not(target_arch = "aarch64"))]
fn speak(_app: &AppHandle, _text: &str, _voice: &str) -> Result<Vec<u8>, String> {
    Err("not-ready".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_hugging_face_is_asked() {
        assert!(allowed(&format!("{REPO}/onnx/model.onnx")));
        assert!(allowed("https://us.aws.cdn.hf.co/xet-bridge-us/abc?x=1"));
        assert!(allowed("https://cas-bridge.xethub.hf.co/x"));
        for no in [
            "http://huggingface.co/x",
            "https://huggingface.co.evil.example/x",
            "https://evilhf.co/x",
            "https://.hf.co/x",
            "https://hf.co.example.com/x",
            "https://huggingface.co:8443/x",
            "https://user@huggingface.co/x",
            "https://example.com/model.onnx",
            "file:///etc/passwd",
        ] {
            assert!(!allowed(no), "{no} should be refused");
        }
    }

    #[test]
    fn the_pinned_files_are_the_ones_described() {
        assert_eq!(VOICES.len(), 6);
        assert!(VOICES.iter().any(|(id, _, _)| *id == DEFAULT_VOICE));
        for (_, _, a) in VOICES.iter() {
            assert_eq!(a.sha256.len(), 64);
            assert_eq!(a.size, 510 * 256 * 4);
        }
        assert_eq!(MODEL.sha256.len(), 64);
    }

    #[test]
    fn one_slow_sentence_doesnt_switch_it_off_but_a_run_does() {
        let (a, slow) = after_sentence(Some(0.3), 5, 2.0);
        assert!(!slow && a < TOO_SLOW);
        let mut avg = Some(0.3);
        let mut off = false;
        for i in 0..8 {
            let (a, s) = after_sentence(avg, 3 + i, 1.4);
            avg = Some(a);
            off |= s;
        }
        assert!(off);
        // Early sentences (warming up) never switch it off on their own.
        assert!(!after_sentence(None, 0, 5.0).1);
    }

    #[test]
    fn a_file_is_present_only_when_it_checks_out() {
        let dir = std::env::temp_dir().join(format!("kith-voice-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("v.bin");
        std::fs::write(&p, b"abc").unwrap();
        // SHA-256 of "abc".
        let good = Asset { path: "v.bin", size: 3, sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" };
        let bad = Asset { path: "v.bin", size: 3, sha256: "0000000000000000000000000000000000000000000000000000000000000000" };
        assert!(!present(&p, &bad));
        assert!(present(&p, &good));
        assert!(p.with_extension("ok").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
