mod binary;
mod client;
mod error;
pub mod local_coding;
mod managed_runtime;
mod transport;

pub use binary::default_app_server_binary;
pub use client::{AppServerClient, AppServerRequestHandle, AppServerSpawnOptions};
pub use error::AppClientError;
pub use managed_runtime::{
    default_managed_app_server_root, ManagedAppServerRuntime, RuntimeUpdateError,
};

#[cfg(test)]
mod tests {
    mod client_tests;
    mod http_tests;
    mod stdio_tests;

    use std::sync::Once;

    use crate::transport::{AppServerEventMessage, EventSender};

    static LOGGER: TestLogger = TestLogger;
    static LOG_INIT: Once = Once::new();

    struct TestLogger;

    impl log::Log for TestLogger {
        fn enabled(&self, metadata: &log::Metadata<'_>) -> bool {
            metadata.level() <= log::Level::Warn
        }

        fn log(&self, _record: &log::Record<'_>) {}

        fn flush(&self) {}
    }

    fn init_test_logger() {
        LOG_INIT.call_once(|| {
            let _ = log::set_logger(&LOGGER);
            log::set_max_level(log::LevelFilter::Warn);
        });
    }

    fn event_channel(
        capacity: usize,
    ) -> (
        EventSender,
        tokio::sync::broadcast::Receiver<AppServerEventMessage>,
    ) {
        tokio::sync::broadcast::channel(capacity)
    }
}
