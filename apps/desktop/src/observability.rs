use std::env;

use once_cell::sync::OnceCell;
use sentry::{types::Dsn, ClientInitGuard};
use tracing::warn;
use tracing_log::LogTracer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

pub struct ObservabilityGuard;

pub fn init() -> ObservabilityGuard {
    init_tracing();
    init_metrics();
    let _ = init_sentry_once();
    ObservabilityGuard
}

fn init_metrics() {
    static METRICS_ONCE: OnceCell<()> = OnceCell::new();
    METRICS_ONCE.get_or_init(|| {
        if let Err(err) = metrics::set_global_recorder(metrics::NoopRecorder) {
            eprintln!("[observability] failed to initialize metrics recorder: {err}");
        }
    });
}

fn init_tracing() {
    static TRACING_ONCE: OnceCell<()> = OnceCell::new();
    TRACING_ONCE.get_or_init(|| {
        if let Err(err) = LogTracer::builder()
            .with_max_level(log::LevelFilter::Trace)
            .init()
        {
            eprintln!(
                "[observability] failed to initialize log tracer; proceeding with existing logger: {err}"
            );
        }

        let env_filter = EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| EnvFilter::new(default_log_filter()));

        #[cfg(debug_assertions)]
        let fmt_layer = tracing_subscriber::fmt::layer()
            .with_target(true)
            .with_file(true)
            .with_line_number(true)
            .pretty();

        #[cfg(not(debug_assertions))]
        let fmt_layer = tracing_subscriber::fmt::layer()
            .with_target(true)
            .with_file(true)
            .with_line_number(true)
            .json()
            .flatten_event(true)
            .with_current_span(true);

        let sentry_layer = sentry_tracing::layer();

        let subscriber = tracing_subscriber::registry()
            .with(env_filter)
            .with(fmt_layer)
            .with(sentry_layer);

        if let Err(err) = subscriber.try_init() {
            eprintln!(
                "[observability] tracing subscriber already initialized; continuing with existing global subscriber: {err}"
            );
        }
    });
}

fn init_sentry() -> Option<ClientInitGuard> {
    let raw_dsn = sentry_dsn()?;
    let dsn = match raw_dsn.parse::<Dsn>() {
        Ok(parsed) => parsed,
        Err(err) => {
            warn!(
                target: "observability",
                error = %err,
                "Invalid Sentry DSN provided; skipping Sentry initialization"
            );
            return None;
        }
    };
    let environment = sentry_environment();

    let traces_sample_rate = env::var("TASKFORCEAI_SENTRY_TRACES_SAMPLE_RATE")
        .ok()
        .and_then(|value| value.parse::<f32>().ok())
        .or_else(|| {
            env::var("TASKFORCE_SENTRY_TRACES_SAMPLE_RATE")
                .ok()
                .and_then(|v| v.parse().ok())
        })
        .or_else(|| {
            env::var("SENTRY_TRACES_SAMPLE_RATE")
                .ok()
                .and_then(|v| v.parse().ok())
        })
        .unwrap_or(if cfg!(debug_assertions) { 0.0 } else { 0.1 });

    let mut options = sentry::ClientOptions {
        release: Some(env!("CARGO_PKG_VERSION").into()),
        environment: Some(environment.clone().into()),
        ..Default::default()
    };
    options.traces_sample_rate = traces_sample_rate;

    if let Ok(server_name) = env::var("HOSTNAME").or_else(|_| env::var("COMPUTERNAME")) {
        options.server_name = Some(server_name.into());
    }

    options.default_integrations = true;

    let guard = sentry::init((dsn, options));
    sentry::configure_scope(|scope| {
        scope.set_tag("app", "desktop");
        scope.set_tag("runtime", "tauri");
        scope.set_tag("environment", &environment);
    });
    tracing::info!(target: "observability", "Initialized Sentry for desktop runtime");
    Some(guard)
}

fn init_sentry_once() -> bool {
    static SENTRY_ONCE: OnceCell<ClientInitGuard> = OnceCell::new();
    if SENTRY_ONCE.get().is_some() {
        return true;
    }
    if let Some(guard) = init_sentry() {
        let _ = SENTRY_ONCE.set(guard);
        return true;
    }
    false
}

fn sentry_dsn() -> Option<String> {
    env::var("TASKFORCEAI_SENTRY_DSN")
        .or_else(|_| env::var("TASKFORCE_SENTRY_DSN"))
        .or_else(|_| env::var("DESKTOP_SENTRY_DSN"))
        .or_else(|_| env::var("SENTRY_DSN"))
        .ok()
        .filter(|value| !value.trim().is_empty())
}

fn sentry_environment() -> String {
    env::var("SENTRY_ENVIRONMENT")
        .or_else(|_| env::var("TASKFORCEAI_ENVIRONMENT"))
        .or_else(|_| env::var("TASKFORCE_ENV"))
        .or_else(|_| env::var("NODE_ENV"))
        .unwrap_or_else(|_| {
            if cfg!(debug_assertions) {
                "development".to_string()
            } else {
                "production".to_string()
            }
        })
}

fn default_log_filter() -> String {
    "info,reqwest=warn".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, OnceLock};

    fn env_lock() -> std::sync::MutexGuard<'static, ()> {
        static ENV_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        ENV_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("environment test lock should not be poisoned")
    }

    #[test]
    fn sentry_dsn_prefers_taskforceai_env() {
        let _guard = env_lock();
        std::env::remove_var("TASKFORCE_SENTRY_DSN");
        std::env::remove_var("DESKTOP_SENTRY_DSN");
        std::env::remove_var("TASKFORCEAI_SENTRY_DSN");
        std::env::remove_var("SENTRY_DSN");
        assert!(sentry_dsn().is_none());

        std::env::set_var("SENTRY_DSN", "generic");
        assert_eq!(sentry_dsn().as_deref(), Some("generic"));

        std::env::set_var("TASKFORCEAI_SENTRY_DSN", "priority");
        assert_eq!(sentry_dsn().as_deref(), Some("priority"));
        std::env::remove_var("TASKFORCEAI_SENTRY_DSN");
        std::env::remove_var("SENTRY_DSN");
    }

    #[test]
    fn sentry_environment_falls_back_to_env_vars() {
        let _guard = env_lock();
        std::env::remove_var("SENTRY_ENVIRONMENT");
        std::env::remove_var("TASKFORCEAI_ENVIRONMENT");
        std::env::remove_var("TASKFORCE_ENV");
        std::env::remove_var("NODE_ENV");
        let env = sentry_environment();
        assert!(!env.is_empty());

        std::env::set_var("SENTRY_ENVIRONMENT", "prod");
        assert_eq!(sentry_environment(), "prod");

        std::env::set_var("TASKFORCEAI_ENVIRONMENT", "desktop");
        std::env::remove_var("SENTRY_ENVIRONMENT");
        assert_eq!(sentry_environment(), "desktop");
        std::env::remove_var("TASKFORCEAI_ENVIRONMENT");
    }

    #[test]
    fn default_log_filter_matches_expected_values() {
        assert_eq!(default_log_filter(), "info,reqwest=warn");
    }

    #[test]
    fn init_sentry_returns_none_without_configured_dsn() {
        let _guard = env_lock();
        std::env::remove_var("TASKFORCEAI_SENTRY_DSN");
        std::env::remove_var("TASKFORCE_SENTRY_DSN");
        std::env::remove_var("DESKTOP_SENTRY_DSN");
        std::env::remove_var("SENTRY_DSN");
        assert!(init_sentry().is_none());
    }

    #[test]
    fn init_runs_without_crashing_when_dsn_missing() {
        let _guard = env_lock();
        std::env::remove_var("TASKFORCEAI_SENTRY_DSN");
        std::env::remove_var("TASKFORCE_SENTRY_DSN");
        std::env::remove_var("DESKTOP_SENTRY_DSN");
        std::env::remove_var("SENTRY_DSN");
        let _guard = init();
    }

    #[test]
    fn init_sentry_accepts_valid_dsn() {
        let _guard = env_lock();
        std::env::remove_var("TASKFORCEAI_SENTRY_DSN");
        std::env::remove_var("TASKFORCE_SENTRY_DSN");
        std::env::remove_var("DESKTOP_SENTRY_DSN");
        std::env::set_var("SENTRY_DSN", "https://public@example.com/1");
        let guard = init_sentry();
        assert!(guard.is_some());
        std::env::remove_var("SENTRY_DSN");
    }

    #[test]
    fn init_sentry_rejects_invalid_dsn() {
        let _guard = env_lock();
        std::env::remove_var("TASKFORCEAI_SENTRY_DSN");
        std::env::remove_var("TASKFORCE_SENTRY_DSN");
        std::env::remove_var("DESKTOP_SENTRY_DSN");
        std::env::set_var("SENTRY_DSN", "not-a-valid-dsn");
        assert!(init_sentry().is_none());
        std::env::remove_var("SENTRY_DSN");
    }

    #[test]
    fn init_sentry_honors_hostname_and_trace_sample_rate_env() {
        let _guard = env_lock();
        std::env::remove_var("TASKFORCEAI_SENTRY_DSN");
        std::env::remove_var("TASKFORCE_SENTRY_DSN");
        std::env::remove_var("DESKTOP_SENTRY_DSN");
        std::env::set_var("SENTRY_DSN", "https://public@example.com/1");
        std::env::set_var("HOSTNAME", "desktop-test-host");
        std::env::set_var("TASKFORCEAI_SENTRY_TRACES_SAMPLE_RATE", "0.25");

        let guard = init_sentry();
        assert!(guard.is_some());

        std::env::remove_var("SENTRY_DSN");
        std::env::remove_var("HOSTNAME");
        std::env::remove_var("TASKFORCEAI_SENTRY_TRACES_SAMPLE_RATE");
    }

    #[test]
    fn init_runs_sentry_setup() {
        let _guard = env_lock();
        std::env::remove_var("TASKFORCEAI_SENTRY_DSN");
        std::env::remove_var("TASKFORCE_SENTRY_DSN");
        std::env::remove_var("DESKTOP_SENTRY_DSN");
        std::env::remove_var("SENTRY_DSN");

        let _guard = init();
        assert!(!init_sentry_once());
    }

    #[test]
    fn init_sentry_once_is_idempotent_when_dsn_missing() {
        let _guard = env_lock();
        std::env::remove_var("TASKFORCEAI_SENTRY_DSN");
        std::env::remove_var("TASKFORCE_SENTRY_DSN");
        std::env::remove_var("DESKTOP_SENTRY_DSN");
        std::env::remove_var("SENTRY_DSN");

        let first = init_sentry_once();
        assert_eq!(init_sentry_once(), first);
    }
}
