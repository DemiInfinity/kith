// Bakes the optional ../kith.config.json (your server address) into the app as its default, and
// declares the app's own commands so each one is only allowed where a capability says so.
fn main() {
    let path = std::path::Path::new("../kith.config.json");
    println!("cargo:rerun-if-changed=../kith.config.json");
    let json = match std::fs::read_to_string(path) {
        Ok(s) => {
            let v: serde_json::Value = serde_json::from_str(&s).expect("mac/kith.config.json is not valid JSON");
            v.to_string()
        }
        Err(_) => String::new(),
    };
    println!("cargo:rustc-env=KITH_DEFAULT_CONFIG={json}");
    // ONNX Runtime (Pip's on-device voice, Apple silicon only) uses `@available` checks, which need
    // clang's own runtime library (___isPlatformVersionAtLeast). Rust links without it, so add it.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") && std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() == Ok("aarch64") {
        if let Ok(out) = std::process::Command::new("xcrun").args(["clang", "-print-resource-dir"]).output() {
            let dir = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !dir.is_empty() {
                println!("cargo:rustc-link-search=native={dir}/lib/darwin");
                println!("cargo:rustc-link-lib=static=clang_rt.osx");
            }
        }
    }
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
        "setup_info",
        "save_server",
        "wrong_app_info",
        "switch_account",
        "open_other_app",
        "native_info",
        "native_notify",
        "native_calendar_snapshot",
        "native_add_event",
        "native_add_reminder",
        "native_pick_document",
        "call_status",
        "mini_mute",
        "mini_end",
        "mini_focus_main",
        "voice_status",
        "voice_prepare",
        "voice_speak",
        "music_watch",
    ])))
    .expect("failed to run tauri-build");
}
