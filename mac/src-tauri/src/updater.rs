// Updates, for when Kith is shipped as a download (docs/macos.md › Updates).
//
// Off unless mac/kith.config.json names both an `updateUrl` (https, Tauri's update JSON; `{app}` in
// it becomes "child" or "parent") and the `updatePublicKey` that signs the updates (`cargo tauri
// signer generate`). Then, a minute after starting and once a day, the app asks that address; a newer version is downloaded only after a
// yes, checked against the public key (an update that isn't signed with it is refused), installed
// over this copy, and the app restarts.

use std::time::Duration;
use tauri::{AppHandle, Url};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;

/// The update address and key, if both are set and the address is https.
pub fn configured(url: Option<&str>, key: Option<&str>) -> Option<(Url, String)> {
    let url = Url::parse(url?.trim()).ok().filter(|u| u.scheme() == "https")?;
    let key = key?.trim();
    (!key.is_empty()).then(|| (url, key.to_string()))
}

pub fn start(app: AppHandle, url: Option<String>, key: Option<String>) {
    // One config builds both apps: `{app}` in the address is "child" or "parent", so each has its own.
    let url = url.map(|u| u.replace("{app}", crate::who::hint(&app)));
    let Some((url, key)) = configured(url.as_deref(), key.as_deref()) else { return };
    tauri::async_runtime::spawn(async move {
        tokio_sleep(Duration::from_secs(60)).await;
        loop {
            if let Err(e) = check(&app, &url, &key).await {
                if std::env::var_os("KITH_DEBUG").is_some() {
                    eprintln!("[kith] update check: {e}");
                }
            }
            tokio_sleep(Duration::from_secs(24 * 3600)).await;
        }
    });
}

async fn tokio_sleep(d: Duration) {
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(d)).await;
}

async fn check(app: &AppHandle, url: &Url, key: &str) -> Result<(), String> {
    let updater = app.updater_builder().endpoints(vec![url.clone()]).map_err(|e| e.to_string())?.pubkey(key).build().map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else { return Ok(()) };
    let name = crate::who::name_for(app, crate::who::Role::SignedOut);
    let a = app.clone();
    let text = format!("{name} {} is ready (you have {}). Install it now? {name} will restart.", update.version, update.current_version);
    let yes = tauri::async_runtime::spawn_blocking(move || {
        a.dialog()
            .message(text)
            .title("Update")
            .kind(MessageDialogKind::Info)
            .buttons(MessageDialogButtons::OkCancelCustom("Install".into(), "Later".into()))
            .blocking_show()
    })
    .await
    .map_err(|e| e.to_string())?;
    if !yes {
        return Ok(());
    }
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::configured;

    #[test]
    fn off_unless_both_are_set_and_the_address_is_https() {
        assert!(configured(None, None).is_none());
        assert!(configured(Some("https://example.com/kith.json"), None).is_none());
        assert!(configured(Some("https://example.com/kith.json"), Some("  ")).is_none());
        assert!(configured(Some("http://example.com/kith.json"), Some("key")).is_none());
        assert!(configured(Some("https://example.com/kith.json"), Some("key")).is_some());
    }
}
