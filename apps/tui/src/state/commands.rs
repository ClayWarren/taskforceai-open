use super::{AppState, FocusArea};

const COMMAND_CATALOG: &[&str] = &[
    "/login",
    "/logout",
    "/upgrade",
    "/update",
    "/status",
    "/inspect",
    "/doctor",
    "/sync",
    "/settings",
    "/model",
    "/ollama",
    "/hybrid",
    "/code",
    "/search",
    "/usage",
    "/account",
    "/artifacts",
    "/mcp",
    "/mock",
    "/attach",
    "/direct",
    "/voice",
    "/orchestrate",
    "/project",
    "/clear",
    "/new",
    "/help",
    "/quit",
    "/goal",
    "/agents",
    "/pet",
    "/context",
    "/memory",
    "/skills",
    "/plugins",
    "/computer",
    "/browser",
    "/channel",
    "/schedule",
    "/pending",
    "/prompt-queue",
    "/pending-changes",
    "/reset-local",
];

impl AppState {
    pub fn command_suggestions_active(&self) -> bool {
        self.focus == FocusArea::Prompt && !self.command_suggestions.is_empty()
    }

    pub fn accept_selected_command_suggestion(&mut self) -> bool {
        let Some(index) = self.selected_command_suggestion else {
            return false;
        };
        let Some(command) = self.command_suggestions.get(index).copied() else {
            return false;
        };
        let remainder = self
            .prompt_input
            .split_once(char::is_whitespace)
            .map_or("", |(_, rest)| rest.trim());
        self.prompt_input = if remainder.is_empty() {
            command.to_string()
        } else {
            format!("{command} {remainder}")
        };
        self.refresh_command_suggestions();
        true
    }

    pub(super) fn select_command_suggestion(&mut self, delta: isize) {
        if self.command_suggestions.is_empty() {
            self.selected_command_suggestion = None;
            return;
        }
        let current = self.selected_command_suggestion.unwrap_or(0);
        let len = self.command_suggestions.len();
        let next = if delta.is_negative() {
            current.checked_sub(1).unwrap_or(len.saturating_sub(1))
        } else {
            (current + 1) % len
        };
        self.selected_command_suggestion = Some(next);
        self.status_line = format!("Command {}", self.command_suggestions[next]);
    }

    pub(super) fn refresh_command_suggestions(&mut self) {
        self.command_suggestions = command_suggestions(&self.prompt_input);
        self.selected_command_suggestion = if self.command_suggestions.is_empty() {
            None
        } else {
            Some(
                self.selected_command_suggestion
                    .unwrap_or(0)
                    .min(self.command_suggestions.len().saturating_sub(1)),
            )
        };
    }
}

fn command_suggestions(input: &str) -> Vec<&'static str> {
    if !input.starts_with('/') {
        return Vec::new();
    }
    let prefix = input
        .split_whitespace()
        .next()
        .unwrap_or(input)
        .to_ascii_lowercase();
    COMMAND_CATALOG
        .iter()
        .copied()
        .filter(|command| command.starts_with(&prefix))
        .collect()
}

#[cfg(test)]
mod tests {
    use std::hint::black_box;
    use std::time::Instant;

    use super::command_suggestions;

    #[test]
    #[ignore = "performance baseline: run explicitly with --ignored --nocapture"]
    fn perf_command_suggestion_refresh() {
        const ITERATIONS: usize = 200_000;
        let prefixes = [
            "/", "/s", "/st", "/sta", "/m", "/mo", "/mod", "/p", "/pe", "/pend",
        ];

        let started = Instant::now();
        let mut rendered = 0_usize;
        for _ in 0..(ITERATIONS / prefixes.len()) {
            for prefix in prefixes {
                black_box(command_suggestions(prefix));
                rendered += 1;
            }
        }
        let elapsed = started.elapsed();
        let avg_nanos = elapsed.as_nanos() / rendered as u128;
        eprintln!(
            "perf_command_suggestion_refresh: rendered={rendered} total_ms={:.3} avg_ns={avg_nanos}",
            elapsed.as_secs_f64() * 1_000.0
        );
    }
}
