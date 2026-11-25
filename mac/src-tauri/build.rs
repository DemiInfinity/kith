// Bakes the optional ../kith.config.json (your server address) into the app as its default.
// The file is git-ignored; without it the app asks for the address on first launch.
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
    tauri_build::build()
}
