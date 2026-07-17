pub const JSONRPC_VERSION: &str = "2.0";
pub const PROTOCOL_VERSION: &str = "2026-07-16";

mod agent;
mod automation;
mod catalog;
mod compat;
mod defaults;
mod events;
mod git_review;
mod initialize;
mod interactions;
mod jsonrpc;
mod models;
mod params;
mod process;
mod records;
mod remote;
mod request;
mod server;
mod settings;
mod sync;
mod voice;
mod workflow;

pub use agent::*;
pub use automation::*;
pub use catalog::*;
pub use compat::*;
pub use events::*;
pub use git_review::*;
pub use initialize::*;
pub use interactions::*;
pub use jsonrpc::*;
pub use models::*;
pub use params::*;
pub use process::*;
pub use records::*;
pub use remote::*;
pub use request::*;
pub use server::*;
pub use settings::*;
pub use sync::*;
pub use voice::*;
pub use workflow::*;

#[cfg(test)]
mod tests;
