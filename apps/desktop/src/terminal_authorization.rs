use url::Url;

const MAIN_WINDOW_LABEL: &str = "main";
const ENABLE_TERMINAL_EXECUTE_ENV: &str = "TASKFORCEAI_DESKTOP_ENABLE_TERMINAL_EXECUTE";

pub(crate) fn terminal_execute_allowed() -> bool {
    terminal_execute_allowed_for(
        cfg!(debug_assertions),
        std::env::var(ENABLE_TERMINAL_EXECUTE_ENV).ok().as_deref(),
    )
}

fn terminal_execute_allowed_for(debug_assertions: bool, configured: Option<&str>) -> bool {
    debug_assertions
        || configured.is_some_and(|value| value == "1" || value.eq_ignore_ascii_case("true"))
}

pub(crate) fn privileged_origin_allowed(url: &Url) -> bool {
    match url.scheme() {
        "tauri" | "asset" => true,
        "http" | "https" => url.host_str().is_some_and(|host| {
            host == "localhost"
                || host.ends_with(".localhost")
                || host
                    .trim_matches(['[', ']'])
                    .parse::<std::net::IpAddr>()
                    .is_ok_and(|address| address.is_loopback())
        }),
        _ => false,
    }
}

pub(crate) fn authorize_terminal_bridge(
    enabled: bool,
    window_label: &str,
    webview_url: Option<&Url>,
) -> Result<(), String> {
    if !enabled {
        return Err(
            "Integrated terminal execution is disabled for this desktop build.".to_string(),
        );
    }
    if window_label != MAIN_WINDOW_LABEL {
        return Err(
            "Integrated terminal execution is only available from the main window.".to_string(),
        );
    }
    if !webview_url.is_some_and(privileged_origin_allowed) {
        return Err(
            "Integrated terminal execution is only available to local desktop origins.".to_string(),
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn execute_enablement_requires_debug_or_explicit_opt_in() {
        assert!(terminal_execute_allowed_for(true, None));
        assert!(terminal_execute_allowed_for(false, Some("1")));
        assert!(terminal_execute_allowed_for(false, Some("TRUE")));
        assert!(!terminal_execute_allowed_for(false, Some("false")));
        assert!(!terminal_execute_allowed_for(false, None));
        assert!(terminal_execute_allowed());
    }

    #[test]
    fn privileged_origins_are_local_desktop_surfaces_only() {
        for value in [
            "tauri://localhost/index.html",
            "asset://localhost/index.html",
            "http://localhost:3210",
            "http://127.0.0.1:3210",
            "http://[::1]:3210",
            "https://preview.localhost",
        ] {
            assert!(privileged_origin_allowed(
                &Url::parse(value).expect("local URL")
            ));
        }
        for value in ["https://taskforceai.chat", "file:///tmp/untrusted.html"] {
            assert!(!privileged_origin_allowed(
                &Url::parse(value).expect("untrusted URL")
            ));
        }
    }

    #[test]
    fn bridge_authorization_checks_enablement_window_and_origin() {
        let local = Url::parse("http://localhost:3210").expect("local URL");
        let remote = Url::parse("https://taskforceai.chat").expect("remote URL");
        assert!(authorize_terminal_bridge(false, "main", Some(&local))
            .expect_err("disabled bridge")
            .contains("disabled"));
        assert!(authorize_terminal_bridge(true, "preview", Some(&local))
            .expect_err("wrong window")
            .contains("main window"));
        assert!(authorize_terminal_bridge(true, "main", Some(&remote))
            .expect_err("remote origin")
            .contains("local desktop origins"));
        assert!(authorize_terminal_bridge(true, "main", None)
            .expect_err("missing origin")
            .contains("local desktop origins"));
        assert_eq!(
            authorize_terminal_bridge(true, "main", Some(&local)),
            Ok(())
        );
    }
}
