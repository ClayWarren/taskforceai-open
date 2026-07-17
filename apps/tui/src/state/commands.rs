use super::{AppState, FocusArea, TaskMode};

const CODE_ONLY_COMMANDS: &[&str] = &["/diff", "/review", "/mention"];

const COMMAND_CATALOG: &[(&str, &str)] = &[
    ("/login", "Sign in"),
    ("/logout", "Sign out"),
    ("/upgrade", "Open plans and billing"),
    ("/update", "Check for TUI updates"),
    ("/status", "Show runtime status"),
    ("/inspect", "Inspect diagnostics"),
    ("/doctor", "Run diagnostics"),
    ("/sync", "Manage synchronization"),
    ("/settings", "View or change settings"),
    ("/model", "Choose a model"),
    ("/effort", "Set reasoning effort"),
    ("/thinking", "Show or hide reasoning"),
    ("/ollama", "Manage local models"),
    ("/hybrid", "Configure hybrid reasoning"),
    ("/code", "Use workspace Code UI"),
    ("/resume", "Resume a task"),
    ("/fork", "Fork the active task"),
    ("/rename", "Rename the active task"),
    ("/archive", "Archive the active task"),
    ("/rollback", "Roll back task history"),
    ("/agent", "Navigate parent and child agents"),
    ("/permissions", "Manage persistent approval rules"),
    ("/diff", "Show workspace changes"),
    ("/review", "Review workspace changes"),
    ("/mention", "Mention a workspace file"),
    ("/copy", "Copy selected output"),
    ("/editor", "Edit the current draft in $VISUAL or $EDITOR"),
    (
        "/shortcuts",
        "Show the complete keyboard shortcut reference",
    ),
    ("/raw", "Toggle raw transcript output"),
    ("/ps", "Show active processes"),
    ("/stop", "Stop the active run"),
    ("/chat", "Use direct Chat mode"),
    ("/work", "Use non-coding Work UI"),
    ("/plan", "Toggle read-only planning"),
    ("/compact", "Compact older task context"),
    ("/hooks", "Inspect lifecycle hooks"),
    ("/theme", "Choose a TUI theme"),
    ("/search", "Search conversations"),
    ("/usage", "Show usage"),
    ("/account", "Show account details"),
    ("/artifacts", "List generated artifacts"),
    ("/mcp", "Manage MCP servers"),
    ("/mock", "Toggle the mock API"),
    ("/attach", "Attach a file"),
    ("/direct", "Toggle quick direct chat"),
    ("/private", "Toggle private chat"),
    ("/voice", "Use voice input"),
    ("/orchestrate", "Configure agent orchestration"),
    ("/project", "Manage projects"),
    ("/clear", "Clear the current view"),
    ("/new", "Start a new prompt"),
    ("/help", "Show command help"),
    ("/quit", "Exit the TUI"),
    ("/goal", "Manage the durable goal"),
    ("/agents", "Manage agent sessions"),
    ("/pet", "Configure the companion"),
    ("/context", "Show context usage"),
    ("/memory", "Show memory status"),
    ("/skills", "List, enable, and invoke skills"),
    ("/plugins", "Manage plugins"),
    ("/computer", "Show computer-use status"),
    ("/browser", "Show browser status"),
    ("/channel", "Manage channels"),
    ("/schedule", "Manage schedules"),
    ("/pending", "Manage pending prompts"),
    ("/prompt-queue", "Manage the prompt queue"),
    ("/pending-changes", "Show pending changes"),
    ("/reset-local", "Clear local data"),
];

pub fn command_description(command: &str) -> &'static str {
    COMMAND_CATALOG
        .iter()
        .find_map(|(candidate, description)| (*candidate == command).then_some(*description))
        .unwrap_or("")
}

pub fn command_help(authenticated: bool, task_mode: TaskMode) -> String {
    let commands = COMMAND_CATALOG
        .iter()
        .filter(|(command, _)| *command != "/private" || authenticated)
        .filter(|(command, _)| task_mode == TaskMode::Code || !CODE_ONLY_COMMANDS.contains(command))
        .map(|(command, description)| format!("{command:<18} {description}"))
        .collect::<Vec<_>>()
        .join("\n");
    format!("{}\n\nSlash commands\n{commands}", keyboard_help(task_mode))
}

pub fn keyboard_help(task_mode: TaskMode) -> String {
    let mut sections = vec![
        "Global\nF1 help · Esc dismiss/back · Ctrl-C clear/stop, twice to quit · Tab focus · Ctrl-B sidebar · Ctrl-G agents · Ctrl-R raw transcript".to_string(),
        "Composer\nEnter submit · Shift-Enter newline · Alt-Enter queue · Ctrl/Alt-Left/Right move by word · Ctrl-W/Ctrl-Backspace delete previous word · Alt-D/Ctrl-Delete delete next word · Ctrl-K kill to line end · Alt-U kill to line start · Ctrl-Y yank · Ctrl-Z undo · Ctrl-Shift-Z redo · Ctrl-O external editor · Ctrl-V paste".to_string(),
        "Conversation\nUp/Down select or prompt history · PgUp/PgDn scroll · Ctrl-X stop selected task · Ctrl-D delete selected conversation".to_string(),
    ];
    match task_mode {
        TaskMode::Chat => sections.push(
            "Chat mode\nCtrl-Q toggles Direct Chat · Ctrl-A autonomy · Ctrl-U Computer Use"
                .to_string(),
        ),
        TaskMode::Work => sections.push(
            "Work mode\nShared execution and structured task progress without coding-specific file/diff UI · Ctrl-A autonomy · Ctrl-U Computer Use"
                .to_string(),
        ),
        TaskMode::Code => sections.push(
            "Code mode\n@file mentions · /diff · /review · /mention · Ctrl-E tool details · Ctrl-A autonomy · Ctrl-U Computer Use"
                .to_string(),
        ),
    }
    sections.join("\n\n")
}

impl AppState {
    pub fn command_suggestions_active(&self) -> bool {
        self.focus == FocusArea::Prompt
            && !self.suggestions_suppressed
            && !self.command_suggestions.is_empty()
    }

    pub fn accept_selected_command_suggestion(&mut self) -> bool {
        let Some(command) = self
            .selected_command_suggestion
            .and_then(|index| self.command_suggestions.get(index).copied())
        else {
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
        self.prompt_cursor = self.prompt_input.len();
        self.selected_command_suggestion = Some(0);
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

    pub fn refresh_command_suggestions(&mut self) {
        self.command_suggestions =
            command_suggestions(&self.prompt_input, self.authenticated, self.task_mode);
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

fn command_suggestions(input: &str, authenticated: bool, task_mode: TaskMode) -> Vec<&'static str> {
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
        .filter(|(command, _)| *command != "/private" || authenticated)
        .filter(|(command, _)| task_mode == TaskMode::Code || !CODE_ONLY_COMMANDS.contains(command))
        .filter_map(|(command, description)| {
            fuzzy_score(&prefix, command, description).map(|score| (*command, score))
        })
        .collect::<Vec<_>>()
        .into_iter()
        .sorted_by_score()
}

trait SortCommandScores {
    fn sorted_by_score(self) -> Vec<&'static str>;
}

impl SortCommandScores for std::vec::IntoIter<(&'static str, i32)> {
    fn sorted_by_score(self) -> Vec<&'static str> {
        let mut matches = self.collect::<Vec<_>>();
        matches.sort_by(|(left_command, left_score), (right_command, right_score)| {
            right_score
                .cmp(left_score)
                .then_with(|| left_command.cmp(right_command))
        });
        matches.into_iter().map(|(command, _)| command).collect()
    }
}

fn fuzzy_score(query: &str, command: &str, description: &str) -> Option<i32> {
    if query == "/" {
        return Some(0);
    }
    let needle = query.trim_start_matches('/').to_ascii_lowercase();
    let command_text = command.trim_start_matches('/').to_ascii_lowercase();
    let description_text = description.to_ascii_lowercase();
    if command_text.starts_with(&needle) {
        return Some(1_000 - command_text.len() as i32);
    }
    subsequence_score(&needle, &command_text)
        .map(|score| 500 + score)
        .or_else(|| subsequence_score(&needle, &description_text))
}

fn subsequence_score(needle: &str, haystack: &str) -> Option<i32> {
    let mut chars = needle.chars();
    let mut current = chars.next()?;
    let mut score = 0_i32;
    let mut consecutive = 0_i32;
    for candidate in haystack.chars() {
        if candidate == current {
            consecutive += 1;
            score += 4 + consecutive;
            let Some(next) = chars.next() else {
                return Some(score - haystack.len() as i32);
            };
            current = next;
        } else {
            consecutive = 0;
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use std::hint::black_box;
    use std::time::Instant;

    use super::{
        command_description, command_help, command_suggestions, fuzzy_score, keyboard_help,
        subsequence_score,
    };
    use crate::state::TaskMode;

    #[test]
    fn command_help_and_fuzzy_helpers_cover_all_modes() {
        assert_eq!(command_description("/login"), "Sign in");
        assert_eq!(command_description("/missing"), "");
        for mode in [TaskMode::Chat, TaskMode::Work, TaskMode::Code] {
            let keyboard = keyboard_help(mode);
            assert!(keyboard.contains("mode"));
            let help = command_help(true, mode);
            assert!(help.contains("/private"));
        }
        assert!(!command_help(false, TaskMode::Chat).contains("/private"));
        assert!(command_suggestions("plain", true, TaskMode::Code).is_empty());
        assert_eq!(fuzzy_score("/", "/login", "Sign in"), Some(0));
        assert!(fuzzy_score("/log", "/login", "Sign in").is_some());
        assert!(fuzzy_score("/lgn", "/login", "Sign in").is_some());
        assert!(fuzzy_score("/sgn", "/login", "Sign in").is_some());
        assert_eq!(subsequence_score("", "login"), None);
        assert_eq!(subsequence_score("zzz", "login"), None);
    }

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
                black_box(command_suggestions(prefix, true, TaskMode::Chat));
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
