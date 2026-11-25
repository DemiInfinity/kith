// Kokoro-82M, on this Mac (Apple silicon only; see main.rs and Cargo.toml): text → phonemes (misaki, Kokoro's own English phonemiser, in British
// English) → the model's tokens → ONNX Runtime → 24 kHz audio. Only on Apple silicon (voice.rs says
// why). Nothing here touches the network: the model and voices are files voice.rs has fetched and
// checked.
//
// The model is onnx-community/Kokoro-82M-v1.0-ONNX's onnx/model.onnx (full precision), with
// inputs input_ids (int64 [1, n]), style (float32 [1, 256]) and speed (float32 [1]), and one output,
// the waveform. Each voice file is 510 × 256 float32 style vectors: the one used is picked by how
// many phoneme tokens the chunk has (as Kokoro does).

use std::path::Path;

pub const SAMPLE_RATE: u32 = 24_000;
const STYLE: usize = 256;
const STYLES: usize = 510;
/// The model takes at most 512 tokens, two of them the padding at each end.
const MAX_TOKENS: usize = 500;

/// Kokoro's phoneme vocabulary (its tokenizer.json): each symbol and its token.
const VOCAB: &[(char, i64)] = &[
    ('\u{0024}', 0), ('\u{003b}', 1), ('\u{003a}', 2), ('\u{002c}', 3), ('\u{002e}', 4), ('\u{0021}', 5), ('\u{003f}', 6), ('\u{2014}', 9), ('\u{2026}', 10),
    ('\u{0022}', 11), ('\u{0028}', 12), ('\u{0029}', 13), ('\u{201c}', 14), ('\u{201d}', 15), ('\u{0020}', 16), ('\u{0303}', 17), ('\u{02a3}', 18), ('\u{02a5}', 19),
    ('\u{02a6}', 20), ('\u{02a8}', 21), ('\u{1d5d}', 22), ('\u{ab67}', 23), ('\u{0041}', 24), ('\u{0049}', 25), ('\u{004f}', 31), ('\u{0051}', 33), ('\u{0053}', 35),
    ('\u{0054}', 36), ('\u{0057}', 39), ('\u{0059}', 41), ('\u{1d4a}', 42), ('\u{0061}', 43), ('\u{0062}', 44), ('\u{0063}', 45), ('\u{0064}', 46), ('\u{0065}', 47),
    ('\u{0066}', 48), ('\u{0068}', 50), ('\u{0069}', 51), ('\u{006a}', 52), ('\u{006b}', 53), ('\u{006c}', 54), ('\u{006d}', 55), ('\u{006e}', 56), ('\u{006f}', 57),
    ('\u{0070}', 58), ('\u{0071}', 59), ('\u{0072}', 60), ('\u{0073}', 61), ('\u{0074}', 62), ('\u{0075}', 63), ('\u{0076}', 64), ('\u{0077}', 65), ('\u{0078}', 66),
    ('\u{0079}', 67), ('\u{007a}', 68), ('\u{0251}', 69), ('\u{0250}', 70), ('\u{0252}', 71), ('\u{00e6}', 72), ('\u{03b2}', 75), ('\u{0254}', 76), ('\u{0255}', 77),
    ('\u{00e7}', 78), ('\u{0256}', 80), ('\u{00f0}', 81), ('\u{02a4}', 82), ('\u{0259}', 83), ('\u{025a}', 85), ('\u{025b}', 86), ('\u{025c}', 87), ('\u{025f}', 90),
    ('\u{0261}', 92), ('\u{0265}', 99), ('\u{0268}', 101), ('\u{026a}', 102), ('\u{029d}', 103), ('\u{026f}', 110), ('\u{0270}', 111), ('\u{014b}', 112), ('\u{0273}', 113),
    ('\u{0272}', 114), ('\u{0274}', 115), ('\u{00f8}', 116), ('\u{0278}', 118), ('\u{03b8}', 119), ('\u{0153}', 120), ('\u{0279}', 123), ('\u{027e}', 125), ('\u{027b}', 126),
    ('\u{0281}', 128), ('\u{027d}', 129), ('\u{0282}', 130), ('\u{0283}', 131), ('\u{0288}', 132), ('\u{02a7}', 133), ('\u{028a}', 135), ('\u{028b}', 136), ('\u{028c}', 138),
    ('\u{0263}', 139), ('\u{0264}', 140), ('\u{03c7}', 142), ('\u{028e}', 143), ('\u{0292}', 147), ('\u{0294}', 148), ('\u{02c8}', 156), ('\u{02cc}', 157), ('\u{02d0}', 158),
    ('\u{02b0}', 162), ('\u{02b2}', 164), ('\u{2193}', 169), ('\u{2192}', 171), ('\u{2197}', 172), ('\u{2198}', 173), ('\u{1d7b}', 177),
];

/// Phonemes → the model's tokens (symbols it doesn't know are left out, as its tokenizer does).
pub fn tokens(phonemes: &str) -> Vec<i64> {
    phonemes.chars().filter_map(|c| VOCAB.iter().find(|(v, _)| *v == c).map(|(_, id)| *id)).collect()
}

/// Splits a long run of phonemes where it can pause (punctuation, then spaces) so each piece fits
/// the model.
pub fn fit(phonemes: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = phonemes.trim().to_string();
    while tokens(&rest).len() > MAX_TOKENS {
        let chars: Vec<char> = rest.chars().collect();
        // The last good break before the limit (counting only symbols the model knows).
        let mut n = 0;
        let (mut punct, mut space) = (None, None);
        for (i, c) in chars.iter().enumerate() {
            if VOCAB.iter().any(|(v, _)| v == c) {
                n += 1;
            }
            if n > MAX_TOKENS {
                break;
            }
            if matches!(c, '.' | '!' | '?' | ',' | ';' | ':' | '—' | '…') {
                punct = Some(i + 1);
            } else if *c == ' ' {
                space = Some(i);
            }
        }
        let cut = punct.or(space).unwrap_or(MAX_TOKENS.min(chars.len()));
        let (a, b) = chars.split_at(cut.max(1));
        out.push(a.iter().collect::<String>().trim().to_string());
        rest = b.iter().collect::<String>().trim().to_string();
    }
    if !rest.is_empty() {
        out.push(rest);
    }
    out.retain(|p| !tokens(p).is_empty());
    out
}

/// A voice file: 510 style vectors of 256 float32s, little-endian.
pub fn read_voice(bytes: &[u8]) -> Result<Vec<f32>, String> {
    if bytes.len() != STYLES * STYLE * 4 {
        return Err("That voice file isn't the right size.".into());
    }
    Ok(bytes.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect())
}

/// The style for a chunk of `n` tokens.
pub fn style(voice: &[f32], n: usize) -> &[f32] {
    let i = n.min(STYLES - 1);
    &voice[i * STYLE..(i + 1) * STYLE]
}

/// 24 kHz mono float samples → a 16-bit WAV, which the page plays the same way as the home voice.
pub fn wav(samples: &[f32]) -> Vec<u8> {
    let data = (samples.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + data as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&1u16.to_le_bytes()); // mono
    out.extend_from_slice(&SAMPLE_RATE.to_le_bytes());
    out.extend_from_slice(&(SAMPLE_RATE * 2).to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data.to_le_bytes());
    for s in samples {
        let v = (s.clamp(-1.0, 1.0) * 32767.0) as i16;
        out.extend_from_slice(&v.to_le_bytes());
    }
    out
}

/// Words misaki doesn't know (made-up names, mostly): put together from the parts it does know,
/// or spelt out if it's short and in capitals. Better a guess than a gap.
struct Guess(misaki_rs::G2P);

impl Guess {
    fn known(&self, piece: &str) -> Option<String> {
        let (ps, _) = self.0.g2p(piece).ok()?;
        let ps = ps.trim().to_string();
        (!ps.is_empty() && !ps.contains(&self.0.unk)).then_some(ps)
    }
}

impl misaki_rs::Fallback for Guess {
    fn phonemize(&self, word: &str) -> Result<String, misaki_rs::fallback::FallbackError> {
        let none = || misaki_rs::fallback::FallbackError::NoPhonemes { word: word.to_string() };
        let letters: Vec<char> = word.chars().filter(|c| c.is_alphabetic()).collect();
        if letters.is_empty() {
            return Err(none());
        }
        if letters.len() <= 5 && letters.iter().all(|c| c.is_uppercase()) {
            let spelt = letters.iter().map(|c| c.to_string()).collect::<Vec<_>>().join(" ");
            return self.known(&spelt).ok_or_else(none);
        }
        if let Some(ps) = self.known(&word.to_lowercase()) {
            return Ok(ps);
        }
        // Longest known pieces from the left (at least three letters), skipping a letter when
        // nothing fits.
        let lower: Vec<char> = word.to_lowercase().chars().filter(|c| c.is_alphabetic()).collect();
        let mut parts = Vec::new();
        let mut i = 0;
        while i < lower.len() {
            let mut found = None;
            for j in (i + 3..=lower.len()).rev() {
                let piece: String = lower[i..j].iter().collect();
                if let Some(ps) = self.known(&piece) {
                    found = Some((j, ps));
                    break;
                }
            }
            match found {
                Some((j, ps)) => {
                    parts.push(ps.replace(' ', ""));
                    i = j;
                }
                None => i += 1,
            }
        }
        if parts.is_empty() {
            Err(none())
        } else {
            Ok(parts.concat())
        }
    }
}

/// British English, as Kokoro's British voices expect.
pub fn phonemiser() -> misaki_rs::G2P {
    let guess = Guess(misaki_rs::G2P::new(misaki_rs::Language::EnglishGB));
    misaki_rs::G2P::with_fallback(misaki_rs::Language::EnglishGB, Some(Box::new(guess)))
}

pub fn phonemes(g2p: &misaki_rs::G2P, text: &str) -> String {
    match g2p.g2p(text) {
        Ok((ps, _)) => ps.replace(&g2p.unk, "").trim().to_string(),
        Err(_) => String::new(),
    }
}

pub use engine::Engine;

mod engine {
    use super::*;
    use ort::session::{builder::GraphOptimizationLevel, Session};
    use ort::value::Tensor;

    pub struct Engine {
        session: Session,
        g2p: misaki_rs::G2P,
        names: [String; 4],
    }

    impl Engine {
        pub fn load(model: &Path) -> Result<Engine, String> {
            let env = ort::init().with_name("kith-voice").build().map_err(|e| e.to_string())?;
            let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).clamp(2, 8);
            let t = std::time::Instant::now();
            let session = Session::builder(&env)
                .map_err(|e| e.to_string())?
                .with_optimization_level(GraphOptimizationLevel::Level3)
                .map_err(|e| e.to_string())?
                .with_intra_threads(threads)
                .map_err(|e| e.to_string())?
                .commit_from_file(model)
                .map_err(|e| e.to_string())?;
            if std::env::var_os("KITH_DEBUG").is_some() {
                eprintln!("[kith] voice model loaded in {:.1}s", t.elapsed().as_secs_f32());
            }
            let input = |want: &str, i: usize| {
                session.inputs().iter().map(|o| o.name().to_string()).find(|n| n.contains(want)).or_else(|| session.inputs().get(i).map(|o| o.name().to_string()))
            };
            let ids = input("input", 0).ok_or("The voice model has no inputs.")?;
            let style = input("style", 1).ok_or("The voice model has no style input.")?;
            let speed = input("speed", 2).ok_or("The voice model has no speed input.")?;
            let out = session.outputs().first().map(|o| o.name().to_string()).ok_or("The voice model has no output.")?;
            Ok(Engine { session, g2p: phonemiser(), names: [ids, style, speed, out] })
        }

        pub fn phonemes(&self, text: &str) -> String {
            phonemes(&self.g2p, text)
        }

        /// One chunk of text, spoken in `voice`, as 24 kHz samples.
        pub fn speak(&mut self, text: &str, voice: &[f32], speed: f32) -> Result<Vec<f32>, String> {
            let mut all = Vec::new();
            for part in fit(&self.phonemes(text)) {
                let inner = tokens(&part);
                let n = inner.len();
                let mut ids = Vec::with_capacity(n + 2);
                ids.push(0i64);
                ids.extend(inner);
                ids.push(0);
                let len = ids.len() as i64;
                let ids = Tensor::from_array(([1i64, len], ids)).map_err(|e| e.to_string())?;
                let st = Tensor::from_array(([1i64, STYLE as i64], style(voice, n).to_vec())).map_err(|e| e.to_string())?;
                let sp = Tensor::from_array(([1i64], vec![speed])).map_err(|e| e.to_string())?;
                let [a, b, c, out] = &self.names;
                let outputs = self
                    .session
                    .run(ort::inputs![a.as_str() => ids, b.as_str() => st, c.as_str() => sp])
                    .map_err(|e| e.to_string())?;
                let (_, wave) = outputs[out.as_str()].try_extract_tensor::<f32>().map_err(|e| e.to_string())?;
                all.extend_from_slice(wave);
            }
            Ok(all)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Speaks with the real downloaded voice (run by hand: cargo test real_voice -- --ignored).
    #[test]
    #[ignore]
    #[cfg(target_arch = "aarch64")]
    fn real_voice() {
        let dir = std::path::PathBuf::from(std::env::var("HOME").unwrap()).join("Library/Application Support/app.kith.mac/kokoro-v1.0");
        let mut e = Engine::load(&dir.join("onnx/model.onnx")).unwrap();
        let voice_file = std::fs::read_dir(dir.join("voices")).unwrap().next().unwrap().unwrap().path();
        let v = read_voice(&std::fs::read(&voice_file).unwrap()).unwrap();
        let s = e.speak("Fractions again? Easy. We'll have them sorted in no time.", &v, 1.0).unwrap();
        let peak = s.iter().fold(0f32, |m, x| m.max(x.abs()));
        let out = std::env::var("KITH_VOICE_OUT").unwrap_or_else(|_| "/tmp/kith-voice.wav".into());
        std::fs::write(&out, wav(&s)).unwrap();
        eprintln!("voice {:?}: {} samples, {:.1}s, peak {peak:.3}", voice_file.file_name().unwrap(), s.len(), s.len() as f32 / SAMPLE_RATE as f32);
        assert!(peak > 0.01, "silent");
    }

    #[test]
    fn tokens_keep_only_what_the_model_knows() {
        assert_eq!(tokens("hˈə"), vec![50, 156, 83]);
        assert_eq!(tokens("a❓b"), vec![43, 44]);
    }

    #[test]
    fn long_phonemes_are_split_at_pauses() {
        let long = "hˈɛləʊ, ".repeat(120);
        let parts = fit(&long);
        assert!(parts.len() > 1);
        for p in &parts {
            assert!(tokens(p).len() <= MAX_TOKENS);
            assert!(p.ends_with(','), "split at a comma: {p:?}");
        }
        assert_eq!(fit("  "), Vec::<String>::new());
    }

    #[test]
    fn style_is_picked_by_length() {
        let voice: Vec<f32> = (0..STYLES * STYLE).map(|i| (i / STYLE) as f32).collect();
        assert_eq!(style(&voice, 3)[0], 3.0);
        assert_eq!(style(&voice, 9999)[0], (STYLES - 1) as f32);
        assert!(read_voice(&[0; 10]).is_err());
    }

    #[test]
    fn wav_header_says_24khz_mono() {
        let w = wav(&[0.0, 1.0, -1.0]);
        assert_eq!(&w[0..4], b"RIFF");
        assert_eq!(u32::from_le_bytes([w[24], w[25], w[26], w[27]]), 24_000);
        assert_eq!(w.len(), 44 + 6);
    }

    #[test]
    fn british_phonemes_and_a_guess_for_made_up_words() {
        let g = phonemiser();
        let ps = phonemes(&g, "Hello there, how was school?");
        assert!(!ps.is_empty() && !ps.contains('❓'), "{ps}");
        // A made-up word still says something.
        assert!(!phonemes(&g, "Zorblewick").is_empty());
    }
}
