use std::borrow::Cow;

use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Padding, Paragraph};
use ratatui::Frame;

use crate::state::AppState;

use super::style::{accent, ok, panel, panel_block, text, text_faint, text_muted, warn};

pub(super) fn render_header(frame: &mut Frame<'_>, area: Rect, state: &AppState) {
    let mut session_details = vec![
        Span::styled("mode:", Style::default().fg(text_faint())),
        Span::styled(
            state.task_mode.label(),
            Style::default().fg(accent()).add_modifier(Modifier::BOLD),
        ),
        Span::raw("  "),
        plan_chip(state.plan_mode_enabled),
    ];
    if state.private_chat_enabled {
        session_details.extend([Span::raw("  "), private_chat_chip(true)]);
    }
    if let Some(summary) = &state.context_summary {
        session_details.extend([
            Span::styled("  ctx:", Style::default().fg(text_faint())),
            Span::styled(
                state.context_usage_percent().map_or_else(
                    || compact_tokens(summary.estimated_tokens).to_string(),
                    |percent| format!("{percent}%"),
                ),
                Style::default().fg(
                    if state
                        .context_usage_percent()
                        .is_some_and(|value| value >= 80)
                    {
                        warn()
                    } else {
                        text_muted()
                    },
                ),
            ),
        ]);
    }
    if state.task_mode.shows_task_progress() && !state.todos.is_empty() {
        let completed = state
            .todos
            .iter()
            .filter(|todo| todo.status == "completed")
            .count();
        session_details.extend([
            Span::styled("  tasks:", Style::default().fg(text_faint())),
            Span::styled(
                format!("{completed}/{}", state.todos.len()),
                Style::default().fg(accent()),
            ),
        ]);
    }
    if state.task_mode == crate::state::TaskMode::Code {
        append_code_context(&mut session_details, state);
    }
    let mut model_details = vec![
        Span::styled(
            "TaskForceAI",
            Style::default().fg(text()).add_modifier(Modifier::BOLD),
        ),
        Span::styled(" TUI", Style::default().fg(accent())),
        Span::styled("  |  ", Style::default().fg(text_faint())),
        Span::styled("model: ", Style::default().fg(text_faint())),
        Span::styled(
            compact_model_id(&state.current_model_id),
            Style::default().fg(accent()).add_modifier(Modifier::BOLD),
        ),
    ];
    if let Some(effort) = effective_reasoning_effort(state) {
        model_details.extend([
            Span::styled("  ·  effort: ", Style::default().fg(text_faint())),
            Span::styled(
                effort.to_string(),
                Style::default().fg(accent()).add_modifier(Modifier::BOLD),
            ),
        ]);
    }
    model_details.extend([
        Span::styled("  ·  ", Style::default().fg(text_faint())),
        Span::styled(
            agent_topology_label(state),
            Style::default().fg(accent()).add_modifier(Modifier::BOLD),
        ),
    ]);
    let lines = vec![Line::from(model_details), Line::from(session_details)];
    frame.render_widget(
        Paragraph::new(lines)
            .style(Style::default().fg(text()))
            .block(
                panel_block(" SESSION ", false)
                    .style(Style::default().bg(panel()))
                    .padding(Padding::horizontal(1)),
            ),
        area,
    );
}

pub(super) fn effective_reasoning_effort(state: &AppState) -> Option<&str> {
    state.reasoning_effort.as_deref().or_else(|| {
        taskforceai_core::models::reasoning_effort_config(&state.current_model_id)
            .map(|config| config.default)
    })
}

pub(super) fn agent_topology_label(state: &AppState) -> &'static str {
    if state.autonomous_mode_enabled {
        "multi-agent"
    } else {
        "single-agent"
    }
}

fn append_code_context<'a>(details: &mut Vec<Span<'a>>, state: &'a AppState) {
    let workspace = state
        .git_context
        .as_ref()
        .and_then(|status| status.repository_root.as_deref())
        .or(state.workspace.as_deref());
    if let Some(workspace) = workspace {
        details.extend([
            Span::styled("  repo:", Style::default().fg(text_faint())),
            Span::styled(
                compact_workspace(workspace),
                Style::default().fg(text_muted()),
            ),
        ]);
    }
    if let Some(status) = &state.git_context {
        let branch = status.branch.as_deref().unwrap_or("detached");
        let dirty =
            status.has_staged_changes || status.has_unstaged_changes || status.has_untracked_files;
        details.extend([
            Span::styled("  git:", Style::default().fg(text_faint())),
            Span::styled(
                format!("{branch}{}", if dirty { "*" } else { "" }),
                Style::default()
                    .fg(if dirty { warn() } else { ok() })
                    .add_modifier(Modifier::BOLD),
            ),
        ]);
    }
}

fn compact_workspace(value: &str) -> Cow<'_, str> {
    let trimmed = value.trim_end_matches(['/', '\\']);
    trimmed
        .rsplit(['/', '\\'])
        .find(|part| !part.is_empty())
        .map(Cow::Borrowed)
        .unwrap_or_else(|| Cow::Borrowed(value))
}

fn compact_tokens(tokens: usize) -> String {
    if tokens >= 1_000_000 {
        format!("{:.1}m", tokens as f64 / 1_000_000.0)
    } else if tokens >= 1_000 {
        format!("{:.1}k", tokens as f64 / 1_000.0)
    } else {
        tokens.to_string()
    }
}

fn plan_chip(enabled: bool) -> Span<'static> {
    if enabled {
        Span::styled(
            "plan:read-only",
            Style::default().fg(warn()).add_modifier(Modifier::BOLD),
        )
    } else {
        Span::styled("plan:off", Style::default().fg(text_faint()))
    }
}

pub(super) fn compact_model_id(model_id: &str) -> Cow<'_, str> {
    const MAX: usize = 28;
    let model_id = model_id.trim();
    if model_id.is_empty() {
        return Cow::Borrowed("default");
    }
    if model_id.chars().count() <= MAX {
        return Cow::Borrowed(model_id);
    }
    let mut output = model_id
        .chars()
        .take(MAX.saturating_sub(3))
        .collect::<String>();
    output.push_str("...");
    Cow::Owned(output)
}

fn private_chat_chip(enabled: bool) -> Span<'static> {
    if enabled {
        Span::styled(
            "[private:on] ",
            Style::default().fg(warn()).add_modifier(Modifier::BOLD),
        )
    } else {
        Span::raw("")
    }
}

#[cfg(test)]
mod tests {
    use ratatui::backend::TestBackend;
    use ratatui::Terminal;
    use taskforceai_app_protocol::{ContextSummaryResult, GitReviewStatusResult};

    use super::{
        agent_topology_label, append_code_context, compact_model_id, compact_tokens,
        effective_reasoning_effort, plan_chip, private_chat_chip, render_header,
    };
    use crate::state::{AppState, TaskMode, TodoItem};
    use crate::test_support::initialized;

    #[test]
    fn private_chat_chip_only_renders_when_enabled() {
        assert_eq!(private_chat_chip(false).content, "");
        assert_eq!(private_chat_chip(true).content, "[private:on] ");
    }

    #[test]
    fn render_header_draws_session_chrome() {
        let mut state = AppState::new(initialized(), Vec::new());
        state.status_line = "Ready".to_string();
        state.current_model_id = "openai/gpt-5".to_string();
        state.reasoning_effort = Some("high".to_string());
        state.autonomous_mode_enabled = true;
        state.private_chat_enabled = true;
        state.task_mode = crate::state::TaskMode::Code;
        state.workspace = Some("/work/taskforceai".to_string());
        let backend = TestBackend::new(100, 4);
        let mut terminal = Terminal::new(backend).expect("terminal");

        terminal
            .draw(|frame| render_header(frame, frame.area(), &state))
            .expect("header should render");

        let rendered =
            terminal
                .backend()
                .buffer()
                .content()
                .iter()
                .fold(String::new(), |mut output, cell| {
                    output.push_str(cell.symbol());
                    output
                });
        assert!(rendered.contains("model: openai/gpt-5"));
        assert!(rendered.contains("effort: high"));
        assert!(rendered.contains("multi-agent"));
        assert!(!rendered.contains("Sync pulled"));
        assert!(!rendered.contains("companion:"));
        assert!(!rendered.contains("theme:"));
        assert!(!rendered.contains("cap:"));
    }

    #[test]
    fn code_context_shows_compact_repository_and_dirty_branch() {
        let mut state = AppState::new(initialized(), Vec::new());
        state.task_mode = TaskMode::Code;
        state.git_context = Some(GitReviewStatusResult {
            is_git_repository: true,
            workspace: "/work/taskforceai".to_string(),
            repository_root: Some("/work/taskforceai".to_string()),
            branch: Some("codex/tui-parity".to_string()),
            head: None,
            upstream: None,
            base_ref: None,
            has_staged_changes: false,
            has_unstaged_changes: true,
            has_untracked_files: false,
            pull_request: None,
            files: Vec::new(),
            message: String::new(),
        });
        let mut details = Vec::new();

        append_code_context(&mut details, &state);
        let text = details
            .iter()
            .map(|span| span.content.as_ref())
            .collect::<String>();

        assert!(text.contains("repo:taskforceai"));
        assert!(text.contains("git:codex/tui-parity*"));
        drop(details);

        state.git_context.as_mut().unwrap().repository_root = None;
        state.git_context.as_mut().unwrap().branch = None;
        state.git_context.as_mut().unwrap().has_unstaged_changes = false;
        state.workspace = Some("C:\\work\\taskforceai\\".to_string());
        let mut details = Vec::new();
        append_code_context(&mut details, &state);
        let text = details
            .iter()
            .map(|span| span.content.as_ref())
            .collect::<String>();
        assert!(text.contains("repo:taskforceai"));
        assert!(text.contains("git:detached"));
    }

    #[test]
    fn header_helpers_cover_context_tasks_and_defaults() {
        let mut state = AppState::new(initialized(), Vec::new());
        assert_eq!(agent_topology_label(&state), "single-agent");
        assert_eq!(compact_model_id("  "), "default");
        assert_eq!(compact_tokens(999), "999");
        assert_eq!(compact_tokens(1_500), "1.5k");
        assert_eq!(compact_tokens(1_500_000), "1.5m");
        assert_eq!(plan_chip(false).content, "plan:off");
        assert_eq!(plan_chip(true).content, "plan:read-only");
        state.current_model_id = "openai/gpt-5.6-sol".to_string();
        assert!(effective_reasoning_effort(&state).is_some());

        state.task_mode = TaskMode::Work;
        state.context_summary = Some(ContextSummaryResult {
            max_tokens: 100,
            estimated_tokens: 85,
            items: Vec::new(),
            suggestions: Vec::new(),
        });
        state.todos = vec![
            TodoItem {
                id: "1".to_string(),
                content: "Done".to_string(),
                status: "completed".to_string(),
                priority: None,
            },
            TodoItem {
                id: "2".to_string(),
                content: "Next".to_string(),
                status: "pending".to_string(),
                priority: None,
            },
        ];
        let backend = TestBackend::new(120, 4);
        let mut terminal = Terminal::new(backend).expect("terminal");
        terminal
            .draw(|frame| render_header(frame, frame.area(), &state))
            .expect("header");
        let rendered = terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(|cell| cell.symbol())
            .collect::<String>();
        assert!(rendered.contains("ctx:85%"));
        assert!(rendered.contains("tasks:1/2"));

        state.context_summary.as_mut().unwrap().max_tokens = 0;
        terminal
            .draw(|frame| render_header(frame, frame.area(), &state))
            .expect("header token fallback");
    }

    #[test]
    #[ignore = "performance baseline: run explicitly with --ignored --nocapture"]
    fn perf_header_chrome_helpers() {
        const ITERATIONS: usize = 250_000;
        let mut state = AppState::new(initialized(), Vec::new());
        state.current_model_id = "openai/gpt-5.6-sol".to_string();

        let started = std::time::Instant::now();
        for _ in 0..ITERATIONS {
            std::hint::black_box(compact_model_id(&state.current_model_id));
        }
        let elapsed = started.elapsed();
        let operations = ITERATIONS;
        let avg_nanos = elapsed.as_nanos() / operations as u128;
        eprintln!(
            "perf_header_chrome_helpers: operations={operations} total_ms={:.3} avg_ns={avg_nanos}",
            elapsed.as_secs_f64() * 1_000.0
        );
    }
}
