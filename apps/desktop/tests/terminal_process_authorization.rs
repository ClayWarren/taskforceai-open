#[path = "../src/terminal_authorization.rs"]
mod terminal_authorization;

use terminal_authorization::{authorize_terminal_bridge, terminal_execute_allowed};
use url::Url;

#[test]
fn process_bridge_enablement_matches_the_build_mode_by_default() {
    let explicitly_enabled = matches!(
        std::env::var("TASKFORCEAI_DESKTOP_ENABLE_TERMINAL_EXECUTE"),
        Ok(value) if value == "1" || value.eq_ignore_ascii_case("true")
    );
    assert_eq!(
        terminal_execute_allowed(),
        cfg!(debug_assertions) || explicitly_enabled
    );
}

#[test]
fn process_bridge_rejects_default_release_access_and_untrusted_webviews() {
    let local_url = Url::parse("http://localhost:3210").expect("local URL");
    let remote_url = Url::parse("https://taskforceai.chat").expect("remote URL");
    let file_url = Url::parse("file:///tmp/untrusted.html").expect("file URL");

    assert_eq!(
        authorize_terminal_bridge(false, "main", Some(&local_url)),
        Err("Integrated terminal execution is disabled for this desktop build.".to_string())
    );
    assert_eq!(
        authorize_terminal_bridge(true, "browser-preview", Some(&local_url)),
        Err("Integrated terminal execution is only available from the main window.".to_string())
    );
    assert_eq!(
        authorize_terminal_bridge(true, "main", Some(&remote_url)),
        Err(
            "Integrated terminal execution is only available to local desktop origins.".to_string()
        )
    );
    for webview_url in [Some(&file_url), None] {
        assert_eq!(
            authorize_terminal_bridge(true, "main", webview_url),
            Err(
                "Integrated terminal execution is only available to local desktop origins."
                    .to_string()
            )
        );
    }
}

#[test]
fn process_bridge_preserves_explicit_local_main_window_access() {
    for url in [
        "tauri://localhost/index.html",
        "asset://localhost/index.html",
        "http://localhost:3210",
    ] {
        let local_url = Url::parse(url).expect("local URL");
        assert_eq!(
            authorize_terminal_bridge(true, "main", Some(&local_url)),
            Ok(()),
            "expected {url} to remain authorized"
        );
    }
}
