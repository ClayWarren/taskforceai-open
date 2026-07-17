mod api;
mod http;
mod interactions;
mod mcp;
mod ollama;
mod protocol;
mod remote_relay;
mod runtime;
mod stdio;
mod tls;

pub use http::{run_http, HttpServerConfig, HttpServerError};
pub use protocol::{AppRequest, AppResponse, AppServerEvent, RunStatus, ServerInfo};
pub use runtime::{AppRuntime, RuntimeConfig, RuntimeError};
pub use stdio::{run_stdio, AppServerError};

pub fn protocol_schema() -> &'static str {
    runtime::protocol_schema()
}
