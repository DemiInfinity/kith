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
    ])))
    .expect("failed to run tauri-build");
}
