const DEFAULT_DEV_PORT: &str = "3210";
const DEFAULT_PROD_PORT: &str = "3000";
const DEFAULT_API_BASE_URL: &str = "https://www.taskforceai.chat/api/v1";

pub(crate) fn resolve_dev_server_url(resolve_prod_port: impl FnOnce() -> String) -> String {
    if let Ok(url) = std::env::var("TASKFORCE_TAURI_DEV_URL") {
        return url;
    }

    if let Ok(port) = std::env::var("TASKFORCE_TAURI_DEV_PORT")
        .or_else(|_| std::env::var("NEXT_PUBLIC_TAURI_DEV_PORT"))
    {
        return format!("http://localhost:{port}");
    }

    if cfg!(debug_assertions) {
        return format!("http://localhost:{DEFAULT_DEV_PORT}");
    }

    let prod_port = resolve_prod_port();
    format!("http://localhost:{prod_port}")
}

pub(crate) fn resolve_api_base_url() -> String {
    const KEYS: [&str; 4] = [
        "TASKFORCE_DESKTOP_API_BASE_URL",
        "TASKFORCE_API_BASE_URL",
        "DESKTOP_API_BASE_URL",
        "NEXT_PUBLIC_API_URL",
    ];

    for key in KEYS {
        if let Ok(value) = std::env::var(key) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }

    DEFAULT_API_BASE_URL.to_string()
}

pub(crate) fn resolve_prod_port() -> String {
    std::env::var("TASKFORCE_TAURI_PROD_PORT")
        .or_else(|_| std::env::var("PORT"))
        .unwrap_or_else(|_| DEFAULT_PROD_PORT.to_string())
}

#[cfg(test)]
mod tests {
    use std::sync::{Mutex, OnceLock};

    use super::{resolve_api_base_url, resolve_dev_server_url, resolve_prod_port};

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    fn with_env_overrides<R>(entries: &[(&str, Option<&str>)], run: impl FnOnce() -> R) -> R {
        let _guard = env_lock().lock().expect("env lock");
        let originals: Vec<(&str, Option<String>)> = entries
            .iter()
            .map(|(key, _)| (*key, std::env::var(key).ok()))
            .collect();

        for (key, value) in entries {
            match value {
                Some(next) => std::env::set_var(key, next),
                None => std::env::remove_var(key),
            }
        }

        let output = run();

        for (key, value) in originals {
            match value {
                Some(previous) => std::env::set_var(key, previous),
                None => std::env::remove_var(key),
            }
        }

        output
    }

    #[test]
    fn resolve_dev_server_url_prefers_explicit_url() {
        with_env_overrides(
            &[
                ("TASKFORCE_TAURI_DEV_URL", Some("http://localhost:9123")),
                ("TASKFORCE_TAURI_DEV_PORT", Some("5001")),
                ("NEXT_PUBLIC_TAURI_DEV_PORT", Some("5002")),
            ],
            || {
                let resolved = resolve_dev_server_url(|| "9999".to_string());
                assert_eq!(resolved, "http://localhost:9123");
            },
        );
    }

    #[test]
    fn resolve_dev_server_url_uses_env_port_when_no_url() {
        with_env_overrides(
            &[
                ("TASKFORCE_TAURI_DEV_URL", None),
                ("TASKFORCE_TAURI_DEV_PORT", Some("4020")),
                ("NEXT_PUBLIC_TAURI_DEV_PORT", Some("5002")),
            ],
            || {
                let resolved = resolve_dev_server_url(|| "9999".to_string());
                assert_eq!(resolved, "http://localhost:4020");
            },
        );
    }

    #[test]
    fn resolve_dev_server_url_fallback_matches_build_mode() {
        with_env_overrides(
            &[
                ("TASKFORCE_TAURI_DEV_URL", None),
                ("TASKFORCE_TAURI_DEV_PORT", None),
                ("NEXT_PUBLIC_TAURI_DEV_PORT", None),
            ],
            || {
                let resolved = resolve_dev_server_url(|| "7777".to_string());
                if cfg!(debug_assertions) {
                    assert_eq!(resolved, "http://localhost:3210");
                } else {
                    assert_eq!(resolved, "http://localhost:7777");
                }
            },
        );
    }

    #[test]
    fn resolve_api_base_url_uses_first_non_empty_key() {
        with_env_overrides(
            &[
                ("TASKFORCE_DESKTOP_API_BASE_URL", Some("   ")),
                (
                    "TASKFORCE_API_BASE_URL",
                    Some(" https://api.internal.local "),
                ),
                ("DESKTOP_API_BASE_URL", Some("https://unused.local")),
                ("NEXT_PUBLIC_API_URL", Some("https://unused-public.local")),
            ],
            || {
                assert_eq!(resolve_api_base_url(), "https://api.internal.local");
            },
        );
    }

    #[test]
    fn resolve_prod_port_honors_priority_order() {
        with_env_overrides(
            &[
                ("TASKFORCE_TAURI_PROD_PORT", Some("8088")),
                ("PORT", Some("9099")),
            ],
            || {
                assert_eq!(resolve_prod_port(), "8088");
            },
        );

        with_env_overrides(
            &[("TASKFORCE_TAURI_PROD_PORT", None), ("PORT", Some("9099"))],
            || {
                assert_eq!(resolve_prod_port(), "9099");
            },
        );
    }
}
