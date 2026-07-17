use ratatui::layout::Alignment;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Clear, Paragraph};
use ratatui::Frame;

use crate::state::{AppState, ModelSelectorState, ModelSelectorTarget};

use super::effort::centered_rect;
use super::header::{agent_topology_label, effective_reasoning_effort};
use super::style::{accent, bg, border_focus, panel, panel_block, text, text_faint, text_muted};

pub(super) fn render_model_selector(frame: &mut Frame<'_>, state: &AppState) {
    let Some(selector) = &state.model_selector else {
        return;
    };
    let height = u16::try_from(selector.options.len().saturating_add(9))
        .unwrap_or(u16::MAX)
        .min(24);
    let area = centered_rect(frame.area(), 86, height);
    let visible_rows = usize::from(area.height.saturating_sub(2)).max(1);
    let selected_line = selector.selected_index.saturating_add(3);
    let scroll = selected_line.saturating_sub(visible_rows.saturating_sub(3));

    frame.render_widget(Clear, area);
    frame.render_widget(
        Paragraph::new(model_lines(state, selector))
            .alignment(Alignment::Left)
            .scroll((scroll.min(u16::MAX as usize) as u16, 0))
            .style(Style::default().bg(panel()).fg(text()))
            .block(panel_block(" SELECT MODEL ", true)),
        area,
    );
}

fn model_lines<'a>(state: &'a AppState, selector: &'a ModelSelectorState) -> Vec<Line<'a>> {
    let active_model = selector
        .selected_model_id
        .as_deref()
        .unwrap_or(&selector.default_model_id);
    let mut lines = vec![
        Line::from(vec![
            Span::styled(
                "Choose a model, then tune effort and agent mode.",
                Style::default().fg(text_muted()),
            ),
            Span::styled(
                if selector.remote_catalog {
                    "  ·  Cloud models"
                } else {
                    "  ·  Local models"
                },
                Style::default().fg(text_faint()),
            ),
        ]),
        Line::from(""),
    ];
    for (index, option) in selector.options.iter().enumerate() {
        let highlighted = selector.selected_index == index;
        let active = active_model == option.id;
        let style = selected_style(highlighted);
        lines.push(Line::from(vec![
            Span::styled(if highlighted { "› " } else { "  " }, style),
            Span::styled(
                provider_mark(&option.id),
                provider_style(&option.id, highlighted),
            ),
            Span::styled("  ", style),
            Span::styled(option.label.as_str(), style.add_modifier(Modifier::BOLD)),
            Span::styled(
                format!("  {}", option.id),
                if highlighted {
                    style
                } else {
                    Style::default().fg(text_faint())
                },
            ),
            Span::styled(
                if active { "  ✓" } else { "" },
                Style::default().fg(accent()).add_modifier(Modifier::BOLD),
            ),
        ]));
    }
    lines.push(Line::from(""));
    lines.push(control_line(
        "Effort",
        effective_reasoning_effort(state).unwrap_or("model default"),
        state.model_selector_target() == Some(ModelSelectorTarget::Effort),
    ));
    lines.push(control_line(
        "Agent Mode",
        if state.autonomous_mode_enabled {
            "Agent Teams"
        } else {
            "Single Agent"
        },
        state.model_selector_target() == Some(ModelSelectorTarget::AgentMode),
    ));
    lines.push(Line::from(""));
    lines.push(Line::from(vec![
        Span::styled("↑/↓", Style::default().fg(accent())),
        Span::styled(" choose  ·  ", Style::default().fg(text_faint())),
        Span::styled("Enter", Style::default().fg(accent())),
        Span::styled(" open/select  ·  ", Style::default().fg(text_faint())),
        Span::styled("Esc", Style::default().fg(accent())),
        Span::styled(" close", Style::default().fg(text_faint())),
        Span::styled(
            format!("  ·  {}", agent_topology_label(state)),
            Style::default().fg(text_muted()),
        ),
    ]));
    lines
}

fn control_line<'a>(label: &'a str, value: &'a str, selected: bool) -> Line<'a> {
    let style = selected_style(selected);
    Line::from(vec![
        Span::styled(if selected { "› " } else { "  " }, style),
        Span::styled(format!("{label:<14}"), style.add_modifier(Modifier::BOLD)),
        Span::styled(value, style),
        Span::styled("  ›", style),
    ])
}

fn selected_style(selected: bool) -> Style {
    if selected {
        Style::default()
            .fg(bg())
            .bg(border_focus())
            .add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(text())
    }
}

fn provider_style(model_id: &str, selected: bool) -> Style {
    if selected {
        selected_style(true)
    } else if provider_mark(model_id) != "◆" {
        Style::default().fg(accent()).add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(text_muted())
    }
}

pub(super) fn provider_mark(model_id: &str) -> &'static str {
    match model_id.split('/').next().unwrap_or_default() {
        "openai" => "◉",
        "anthropic" => "A",
        "google" => "✦",
        "xai" => "×",
        "meta" => "∞",
        "ollama" => "◌",
        _ if model_id.starts_with("gpt-")
            || model_id.starts_with("o1")
            || model_id.starts_with("o3")
            || model_id.starts_with("o4")
            || model_id.starts_with("codex") =>
        {
            "◉"
        }
        _ if model_id.starts_with("claude") => "A",
        _ if model_id.starts_with("gemini") => "✦",
        _ if model_id.starts_with("grok") => "×",
        _ if model_id.starts_with("llama") => "∞",
        _ => "◆",
    }
}

#[cfg(test)]
mod tests {
    use ratatui::backend::TestBackend;
    use ratatui::Terminal;
    use taskforceai_app_protocol::{ModelListResult, ModelOptionRecord};

    use super::*;
    use crate::state::UiAction;
    use crate::test_support::initialized;

    fn model_list() -> ModelListResult {
        ModelListResult {
            enabled: true,
            options: vec![ModelOptionRecord {
                id: "openai/gpt-5".to_string(),
                label: "GPT-5".to_string(),
                badge: "pro".to_string(),
                description: None,
                usage_multiple: Some(1.0),
                reasoning_effort_levels: vec!["low".to_string(), "high".to_string()],
                default_reasoning_effort: Some("high".to_string()),
            }],
            default_model_id: "openai/gpt-5".to_string(),
            selected_model_id: None,
            remote_catalog: true,
        }
    }

    #[test]
    fn polished_model_overlay_includes_provider_marks_and_nested_controls() {
        let mut state = AppState::new(initialized(), Vec::new());
        state.apply(UiAction::ModelSelectorOpened(model_list()));
        let backend = TestBackend::new(100, 30);
        let mut terminal = Terminal::new(backend).expect("terminal");

        terminal
            .draw(|frame| render_model_selector(frame, &state))
            .expect("model selector should render");
        let rendered = terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(|cell| cell.symbol())
            .collect::<String>();
        assert!(rendered.contains("SELECT MODEL"));
        assert!(rendered.contains("Effort"));
        assert!(rendered.contains("Agent Mode"));
    }

    #[test]
    fn provider_marks_cover_known_and_fallback_models() {
        assert_eq!(provider_mark("openai/gpt-5"), "◉");
        assert_eq!(provider_mark("gpt-5.6-sol"), "◉");
        assert_eq!(provider_mark("anthropic/claude"), "A");
        assert_eq!(provider_mark("google/gemini"), "✦");
        assert_eq!(provider_mark("xai/grok"), "×");
        assert_eq!(provider_mark("meta/llama"), "∞");
        assert_eq!(provider_mark("ollama/llama"), "◌");
        assert_eq!(provider_mark("claude-sonnet"), "A");
        assert_eq!(provider_mark("gemini-pro"), "✦");
        assert_eq!(provider_mark("grok-4"), "×");
        assert_eq!(provider_mark("llama-4"), "∞");
        assert_eq!(provider_mark("custom/model"), "◆");

        let mut state = AppState::new(initialized(), Vec::new());
        let mut list = model_list();
        list.remote_catalog = false;
        list.options.push(ModelOptionRecord {
            id: "custom/model".to_string(),
            label: "Custom".to_string(),
            badge: "local".to_string(),
            description: None,
            usage_multiple: None,
            reasoning_effort_levels: Vec::new(),
            default_reasoning_effort: None,
        });
        state.apply(UiAction::ModelSelectorOpened(list));
        state.autonomous_mode_enabled = true;
        state.model_selector.as_mut().unwrap().selected_index = 1;
        let selector = state.model_selector.as_ref().unwrap();
        let lines = model_lines(&state, selector);
        assert!(lines
            .iter()
            .any(|line| line.to_string().contains("Local models")));
        assert_eq!(provider_style("custom/model", false).fg, Some(text_muted()));
        assert_eq!(provider_style("openai/gpt-5", false).fg, Some(accent()));
        assert_eq!(provider_style("openai/gpt-5", true).fg, Some(bg()));
    }
}
