use std::env;
use std::io::{self, Write};

// coverage:ignore-start -- writes desktop notification escape sequences to the live terminal.
pub(crate) fn notify(message: &str) {
    let mode = env::var("TASKFORCE_TUI_NOTIFICATIONS")
        .unwrap_or_else(|_| "osc9".to_string())
        .to_ascii_lowercase();
    if matches!(mode.as_str(), "off" | "false" | "0") {
        return;
    }
    let clean = message
        .chars()
        .filter(|character| !character.is_control())
        .take(120)
        .collect::<String>();
    let sequence = if mode == "bell" || mode == "bel" {
        "\x07".to_string()
    } else {
        format!("\x1b]9;TaskForceAI: {clean}\x07")
    };
    let _ = io::stderr().write_all(sequence.as_bytes());
    let _ = io::stderr().flush();
}
// coverage:ignore-end
