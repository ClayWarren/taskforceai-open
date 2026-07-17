use ratatui::layout::Alignment;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Clear, Paragraph};
use ratatui::Frame;

use crate::state::{AppState, TeamConfigState};

use super::effort::centered_rect;
use super::model::provider_mark;
use super::style::{accent, bg, border_focus, panel, panel_block, text, text_faint, text_muted};

pub(super) fn render_agent_mode_selector(frame: &mut Frame<'_>, state: &AppState) {
    let Some(selector) = &state.agent_mode_selector else {
        return;
    };
    let area = centered_rect(
        frame.area(),
        68,
        if state.autonomous_mode_enabled { 11 } else { 8 },
    );
    frame.render_widget(Clear, area);
    frame.render_widget(
        Paragraph::new(agent_mode_lines(state, selector.selected_index))
            .alignment(Alignment::Left)
            .style(Style::default().bg(panel()).fg(text()))
            .block(panel_block(" AGENT MODE ", true)),
        area,
    );
}

pub(super) fn render_team_config(frame: &mut Frame<'_>, state: &AppState) {
    let Some(config) = &state.team_config else {
        return;
    };
    let height = u16::try_from(
        config
            .visible_role_count()
            .saturating_mul(2)
            .saturating_add(12),
    )
    .unwrap_or(u16::MAX);
    let area = centered_rect(frame.area(), 88, height);
    let visible_rows = usize::from(area.height.saturating_sub(2)).max(1);
    let selected_line = team_config_selected_line(config);
    let scroll = selected_line.saturating_sub(visible_rows.saturating_sub(3));
    frame.render_widget(Clear, area);
    frame.render_widget(
        Paragraph::new(team_config_lines(config))
            .alignment(Alignment::Left)
            .scroll((scroll.min(u16::MAX as usize) as u16, 0))
            .style(Style::default().bg(panel()).fg(text()))
            .block(panel_block(" CUSTOM ORCHESTRATION ", true)),
        area,
    );
}

fn team_config_selected_line(config: &TeamConfigState) -> usize {
    match config.selected_index {
        0 => 3,
        1 => 4,
        row if row < config.visible_role_count().saturating_add(2) => {
            6 + row.saturating_sub(2).saturating_mul(2)
        }
        _ => 7 + config.visible_role_count().saturating_mul(2),
    }
}

fn agent_mode_lines(state: &AppState, selected_index: usize) -> Vec<Line<'static>> {
    let mut lines = vec![
        Line::from(Span::styled(
            "Choose one assistant or a coordinated team.",
            Style::default().fg(text_muted()),
        )),
        Line::from(""),
        selectable_line(
            "Single Agent",
            "One assistant handles the request",
            selected_index == 0,
            !state.autonomous_mode_enabled,
        ),
        selectable_line(
            "Agent Teams",
            "Multiple agents work in parallel",
            selected_index == 1,
            state.autonomous_mode_enabled,
        ),
    ];
    if state.autonomous_mode_enabled {
        lines.extend([
            Line::from(""),
            value_line(
                "Parallel Agents",
                &state.orchestration_agent_count.to_string(),
                selected_index == 2,
            ),
            value_line("Custom Models", "Configure roles  ›", selected_index == 3),
        ]);
    }
    lines.extend([
        Line::from(""),
        Line::from(vec![
            Span::styled("↑/↓", Style::default().fg(accent())),
            Span::styled(" choose  ·  ", Style::default().fg(text_faint())),
            Span::styled("Enter", Style::default().fg(accent())),
            Span::styled(" select/open  ·  ", Style::default().fg(text_faint())),
            Span::styled("Esc", Style::default().fg(accent())),
            Span::styled(" back", Style::default().fg(text_faint())),
        ]),
    ]);
    lines
}

fn team_config_lines(config: &TeamConfigState) -> Vec<Line<'static>> {
    let mut lines = vec![
        Line::from(Span::styled(
            "Assign specialized models to each agent role.",
            Style::default().fg(text_muted()),
        )),
        Line::from(""),
        value_line(
            "Boss / Default",
            &model_display(config, &config.default_model_id),
            false,
        ),
        value_line(
            "Parallel Agents",
            &config.agent_count.to_string(),
            config.selected_index == 0,
        ),
        value_line(
            "Mission Budget",
            &config
                .orchestration
                .budget
                .map_or_else(|| "Unlimited".to_string(), |value| format!("${value:.2}")),
            config.selected_index == 1,
        ),
        Line::from(""),
    ];
    for (index, role) in config
        .orchestration
        .roles
        .iter()
        .take(config.visible_role_count())
        .enumerate()
    {
        let model = role.model_id.as_deref().map_or_else(
            || "↳ Boss / Default".to_string(),
            |model_id| model_display(config, model_id),
        );
        lines.push(value_line(
            &role.name,
            &model,
            config.selected_index == index + 2,
        ));
        lines.push(Line::from(Span::styled(
            format!("    {}", role.description),
            Style::default().fg(text_faint()),
        )));
    }
    let apply_index = config.visible_role_count() + 2;
    lines.extend([
        Line::from(""),
        value_line(
            "Apply Configuration",
            "Save team setup",
            config.selected_index == apply_index,
        ),
        Line::from(""),
        Line::from(vec![
            Span::styled("↑/↓", Style::default().fg(accent())),
            Span::styled(" row  ·  ", Style::default().fg(text_faint())),
            Span::styled("←/→", Style::default().fg(accent())),
            Span::styled(" adjust  ·  ", Style::default().fg(text_faint())),
            Span::styled("Enter", Style::default().fg(accent())),
            Span::styled(" adjust/apply  ·  ", Style::default().fg(text_faint())),
            Span::styled("Esc", Style::default().fg(accent())),
            Span::styled(" cancel", Style::default().fg(text_faint())),
        ]),
    ]);
    lines
}

fn model_display(config: &TeamConfigState, model_id: &str) -> String {
    let label = config
        .models
        .iter()
        .find(|model| model.id == model_id)
        .map_or(model_id, |model| model.label.as_str());
    format!("{}  {label}", provider_mark(model_id))
}

fn selectable_line(title: &str, detail: &str, selected: bool, active: bool) -> Line<'static> {
    let style = selected_style(selected);
    Line::from(vec![
        Span::styled(if selected { "› " } else { "  " }, style),
        Span::styled(format!("{title:<18}"), style.add_modifier(Modifier::BOLD)),
        Span::styled(detail.to_string(), style),
        Span::styled(
            if active { "  ✓" } else { "" },
            Style::default().fg(accent()).add_modifier(Modifier::BOLD),
        ),
    ])
}

fn value_line(label: &str, value: &str, selected: bool) -> Line<'static> {
    let style = selected_style(selected);
    Line::from(vec![
        Span::styled(if selected { "› " } else { "  " }, style),
        Span::styled(format!("{label:<22}"), style.add_modifier(Modifier::BOLD)),
        Span::styled(value.to_string(), style),
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

#[cfg(test)]
mod tests {
    use ratatui::backend::TestBackend;
    use ratatui::Terminal;
    use taskforceai_app_protocol::{OrchestrationConfig, OrchestrationRole};

    use super::*;
    use crate::test_support::initialized;

    #[test]
    fn agent_mode_and_team_config_render_as_focused_overlays() {
        let mut state = AppState::new(initialized(), Vec::new());
        state.autonomous_mode_enabled = true;
        state.open_agent_mode_selector();
        let backend = TestBackend::new(100, 30);
        let mut terminal = Terminal::new(backend).expect("terminal");
        terminal
            .draw(|frame| render_agent_mode_selector(frame, &state))
            .expect("agent mode should render");
        let rendered = terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(|cell| cell.symbol())
            .collect::<String>();
        assert!(rendered.contains("Parallel Agents"));
        assert!(rendered.contains("Custom Models"));

        state.open_team_config(
            OrchestrationConfig {
                roles: vec![OrchestrationRole {
                    name: "Researcher".to_string(),
                    description: "Web search".to_string(),
                    model_id: Some("openai/gpt-5".to_string()),
                }],
                budget: None,
            },
            vec![taskforceai_app_protocol::ModelOptionRecord {
                id: "openai/gpt-5".to_string(),
                label: "GPT-5".to_string(),
                badge: "pro".to_string(),
                description: None,
                usage_multiple: None,
                reasoning_effort_levels: Vec::new(),
                default_reasoning_effort: None,
            }],
        );
        terminal
            .draw(|frame| render_team_config(frame, &state))
            .expect("team config should render");
        let rendered = terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(|cell| cell.symbol())
            .collect::<String>();
        assert!(rendered.contains("CUSTOM ORCHESTRATION"));
        assert!(rendered.contains("GPT-5"));
        assert!(rendered.contains("Apply Configuration"));

        state.team_config.as_mut().unwrap().orchestration.roles[0].model_id = None;
        assert!(team_config_lines(state.team_config.as_ref().unwrap())
            .iter()
            .any(|line| line.to_string().contains("Boss / Default")));

        let config = state.team_config.as_mut().expect("team config");
        config.selected_index = 1;
        assert_eq!(team_config_selected_line(config), 4);
        config.selected_index = 2;
        assert_eq!(team_config_selected_line(config), 6);
        config.selected_index = 3;
        assert_eq!(team_config_selected_line(config), 9);
    }
}
