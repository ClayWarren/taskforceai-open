pub const JSONRPC_VERSION: &str = "2.0";
pub const PROTOCOL_VERSION: &str = "2026-05-23";

mod agent;
mod automation;
mod defaults;
mod events;
mod initialize;
mod jsonrpc;
mod models;
mod params;
mod records;
mod request;
mod server;
mod settings;
mod sync;
mod workflow;

pub use agent::*;
pub use automation::*;
pub use events::*;
pub use initialize::*;
pub use jsonrpc::*;
pub use models::*;
pub use params::*;
pub use records::*;
pub use request::*;
pub use server::*;
pub use settings::*;
pub use sync::*;
pub use workflow::*;

#[cfg(test)]
mod tests;
