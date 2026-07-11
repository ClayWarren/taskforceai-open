mod api;
mod http;
mod mcp;
mod ollama;
mod protocol;
mod runtime;
mod stdio;

pub use http::{run_http, HttpServerConfig, HttpServerError};
pub use protocol::{AppRequest, AppResponse, AppServerEvent, RunStatus, ServerInfo};
pub use runtime::{AppRuntime, RuntimeConfig, RuntimeError};
pub use stdio::{run_stdio, AppServerError};
