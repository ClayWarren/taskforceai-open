use thiserror::Error;

use crate::runtime::RuntimeError;

mod dispatch;
#[cfg(test)]
mod dispatch_tests;
mod handler;
mod methods;
mod responses;
#[cfg(test)]
mod tests;
mod transport;

pub(crate) use handler::handle_request;
pub(crate) use responses::extend_event_notifications;
pub use transport::run_stdio;
#[cfg(test)]
pub(crate) use transport::run_stdio_in_memory;

#[derive(Debug, Error)]
pub enum AppServerError {
    #[error("read transport: {0}")]
    Read(#[from] std::io::Error),
    #[error("write transport: {0}")]
    Write(std::io::Error),
    #[error("encode response: {0}")]
    Encode(serde_json::Error),
    #[error("runtime: {0}")]
    Runtime(#[from] RuntimeError),
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum ServerAction {
    Continue,
    Shutdown,
}
