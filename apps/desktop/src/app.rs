#[cfg(not(coverage))]
mod bootstrap;
#[cfg(not(coverage))]
mod config;
#[cfg(not(coverage))]
mod runtime;

#[cfg(not(coverage))]
pub use runtime::run;

#[cfg(coverage)]
pub fn run() {
    let _telemetry = crate::observability::init();
    tracing::info!("Skipping Tauri runtime initialization during coverage runs");
}
