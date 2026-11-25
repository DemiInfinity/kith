// The app's own requests to the Kith server (who's signed in, the parent's inbox, signing out).
//
// One agent for all of them: no redirects followed (an answer that points elsewhere is an answer,
// not something to chase with her cookie attached), statuses read rather than turned into errors,
// and a time limit. The session cookie goes only to the server it came from.

use std::time::Duration;

pub fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .max_redirects(0)
        .http_status_as_error(false)
        .timeout_global(Some(Duration::from_secs(15)))
        .build()
        .into()
}

/// The `Cookie` header for the window's Kith session.
pub fn session(sid: &str) -> String {
    format!("kith_sid={sid}")
}

/// For KITH_DEBUG logs: the origin only. Paths and queries can carry one-time codes, handoff ids
/// and names.
pub fn redact(url: &tauri::Url) -> String {
    match url.scheme() {
        "http" | "https" => url.origin().ascii_serialization(),
        other => format!("{other}:"),
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn redact_keeps_only_the_origin() {
        let u = tauri::Url::parse("https://auth.example.com/authorize?code=secret&state=x#frag").unwrap();
        assert_eq!(super::redact(&u), "https://auth.example.com");
        let m = tauri::Url::parse("mailto:someone@example.com").unwrap();
        assert_eq!(super::redact(&m), "mailto:");
    }
}
