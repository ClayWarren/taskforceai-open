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
        let Some(command) = self.command_suggestions.get(index).cloned() else {
            return false;
        };
        let remainder = self
            .prompt_input
            .split_once(char::is_whitespace)
            .map_or("", |(_, rest)| rest.trim());
        self.prompt_input = if remainder.is_empty() {
            command
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

fn command_suggestions(input: &str) -> Vec<String> {
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
        .map(ToOwned::to_owned)
        .collect()
}
