use std::time::{Duration, Instant};

use tauri::{async_runtime, AppHandle, Manager, Url};
use tokio::time::sleep;
use tracing::{debug, error, info, warn};

use crate::state::BootstrapState;

const EMBEDDED_APP_URL: &str = "tauri://localhost/index.html";

pub(crate) fn start_bootstrap(handle: AppHandle, state: BootstrapState, server_url: String) {
    if should_wait_for_dev_server() {
        spawn_bootstrap_tasks(handle, state, server_url);
    } else {
        state.mark_ready();
        if cfg!(debug_assertions) {
            navigate_window_to(&handle, &server_url);
        } else {
            navigate_window_to(&handle, EMBEDDED_APP_URL);
        }
        info!(
            target: "bootstrap",
            "Skipping dev-server readiness polling; marking bootstrap ready"
        );
        schedule_bootstrap_fallback(handle, state, server_url);
    }
}

fn should_wait_for_dev_server() -> bool {
    if !cfg!(debug_assertions) {
        return false;
    }

    !matches!(
        std::env::var("TASKFORCE_TAURI_SKIP_WAIT"),
        Ok(value) if value == "1" || value.eq_ignore_ascii_case("true")
    )
}

fn spawn_bootstrap_tasks(handle: AppHandle, state: BootstrapState, target_url: String) {
    let bootstrap_handle = handle.clone();
    async_runtime::spawn(async move {
        let started_at = Instant::now();
        let http_client = match reqwest::Client::builder()
            .timeout(Duration::from_secs(2))
            .build()
        {
            Ok(client) => client,
            Err(err) => {
                error!(
                    target: "bootstrap",
                    error = %err,
                    "Failed to build HTTP client for bootstrap"
                );
                state.mark_ready();
                schedule_bootstrap_fallback(bootstrap_handle, state, target_url);
                return;
            }
        };

        let mut retries = 0;
        let mut last_error: Option<String> = None;
        while retries < 30 {
            if bootstrap_handle.get_webview_window("main").is_none() {
                debug!(
                    target: "bootstrap",
                    "Main window gone before bootstrap completed; exiting poll loop"
                );
                return;
            }

            match http_client.head(&target_url).send().await {
                Ok(response) if response.status().is_success() => {
                    info!(
                        target: "bootstrap",
                        url = %target_url,
                        status = %response.status().as_u16(),
                        elapsed_ms = started_at.elapsed().as_millis(),
                        "Web server responded with success; waiting for frontend signal before showing window"
                    );
                    navigate_window_to(&bootstrap_handle, &target_url);
                    break;
                }
                Ok(response) => {
                    last_error = Some(format!("status {}", response.status().as_u16()));
                }
                Err(err) => last_error = Some(err.to_string()),
            }

            retries += 1;
            let backoff_ms = (250_u64)
                .saturating_mul(1_u64 << retries.min(6))
                .min(4_000_u64);
            sleep(Duration::from_millis(backoff_ms)).await;
        }

        if retries >= 30 {
            warn!(
                target: "bootstrap",
                url = %target_url,
                last_error = last_error.as_deref(),
                "Dev server never became ready after polling; proceeding with fallback display"
            );
        }

        state.mark_ready();
        info!(
            target: "bootstrap",
            elapsed_ms = started_at.elapsed().as_millis(),
            "Desktop bootstrap completed; waiting for frontend signal to show window"
        );

        schedule_bootstrap_fallback(bootstrap_handle, state, target_url);
    });
}

fn schedule_bootstrap_fallback(handle: AppHandle, state: BootstrapState, target_url: String) {
    async_runtime::spawn(async move {
        sleep(Duration::from_secs(10)).await;
        if state.is_ready() && !state.has_displayed() {
            warn!(
                target: "bootstrap",
                "Frontend never signaled readiness; showing window via fallback timer"
            );
            if let Some(window) = handle.get_webview_window("main") {
                if !state.mark_displayed() {
                    return;
                }
                if cfg!(debug_assertions) {
                    navigate_window_to(&handle, &target_url);
                } else {
                    navigate_window_to(&handle, EMBEDDED_APP_URL);
                }
                if let Err(err) = window.show() {
                    state.reset_displayed();
                    error!(
                        target: "bootstrap",
                        error = ?err,
                        "Failed to show window during fallback"
                    );
                    return;
                }
                let _ = window.set_focus();
                #[cfg(debug_assertions)]
                {
                    window.open_devtools();
                }
            }
        }
    });
}

fn navigate_window_to(handle: &AppHandle, target: &str) {
    if let Some(window) = handle.get_webview_window("main") {
        match Url::parse(target) {
            Ok(url) => {
                if let Err(err) = window.navigate(url) {
                    warn!(
                        target: "bootstrap",
                        error = ?err,
                        url = target,
                        "Failed to navigate window to embedded server URL"
                    );
                }
            }
            Err(err) => warn!(
                target: "bootstrap",
                error = %err,
                url = target,
                "Invalid server URL; cannot navigate window"
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Mutex, OnceLock};

    use super::should_wait_for_dev_server;

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    fn with_env_var<R>(key: &str, value: Option<&str>, run: impl FnOnce() -> R) -> R {
        let _guard = env_lock().lock().expect("env lock");
        let original = std::env::var(key).ok();

        match value {
            Some(new_value) => std::env::set_var(key, new_value),
            None => std::env::remove_var(key),
        }

        let output = run();

        match original {
            Some(previous) => std::env::set_var(key, previous),
            None => std::env::remove_var(key),
        }

        output
    }

    #[test]
    fn should_wait_for_dev_server_honors_skip_flag() {
        with_env_var("TASKFORCE_TAURI_SKIP_WAIT", Some("true"), || {
            assert!(!should_wait_for_dev_server());
        });

        with_env_var("TASKFORCE_TAURI_SKIP_WAIT", Some("1"), || {
            assert!(!should_wait_for_dev_server());
        });
    }

    #[test]
    fn should_wait_for_dev_server_defaults_by_build_mode() {
        with_env_var("TASKFORCE_TAURI_SKIP_WAIT", None, || {
            assert_eq!(should_wait_for_dev_server(), cfg!(debug_assertions));
        });
    }

    #[test]
    fn should_wait_for_dev_server_ignores_non_skip_values() {
        with_env_var("TASKFORCE_TAURI_SKIP_WAIT", Some("false"), || {
            assert_eq!(should_wait_for_dev_server(), cfg!(debug_assertions));
        });
    }
}
