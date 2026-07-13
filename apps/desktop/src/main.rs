// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![cfg_attr(coverage, allow(dead_code))]

mod app;
mod app_server;
mod appshots;
mod commands;
mod local_coding;
mod locked_computer_use;
mod mcp;
mod observability;
mod process_output;
mod screen_memory;
mod state;
mod voice;
mod worktrees;

#[cfg(not(tarpaulin_include))]
fn main() {
    app::run();
}

#[cfg(test)]
mod tests;
