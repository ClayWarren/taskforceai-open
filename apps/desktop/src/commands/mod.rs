#[cfg(not(coverage))]
use std::path::PathBuf;

#[cfg(not(coverage))]
use crate::state::AppState;

#[cfg(not(coverage))]
fn workspace_root(state: &AppState) -> Result<PathBuf, String> {
    let root = state
        .local_coding_workspace()
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    root.canonicalize().map_err(|error| {
        format!(
            "Failed to resolve workspace root {}: {error}",
            root.display()
        )
    })
}

#[cfg(not(coverage))]
mod app_server;
#[cfg(not(coverage))]
pub use app_server::*;

#[cfg(not(coverage))]
mod browser;
#[cfg(not(coverage))]
pub use browser::*;

mod logging;
#[cfg_attr(coverage, allow(unused_imports))]
pub use logging::*;

#[cfg(not(coverage))]
mod mcp;
#[cfg(not(coverage))]
pub use mcp::*;

#[cfg(not(coverage))]
mod ui;
#[cfg(not(coverage))]
pub use ui::*;

#[cfg(not(coverage))]
mod update;
#[cfg(not(coverage))]
pub use update::*;
