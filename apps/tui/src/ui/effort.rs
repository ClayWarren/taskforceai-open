use ratatui::layout::{Alignment, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Clear, Paragraph};
use ratatui::Frame;

use crate::state::{AppState, EffortSelectorState};

use super::style::{panel_block, ACCENT, PANEL, TEXT, TEXT_FAINT, TEXT_MUTED};

pub(super) fn render_effort_selector(frame: &mut Frame<'_>, state: &AppState) {
    let Some(selector) = &state.effort_selector else {
        return;
    };
    let area = centered_rect(frame.area(), 92, 10);
    frame.render_widget(Clear, area);
    frame.render_widget(
        Paragraph::new(effort_lines(
            selector,
            usize::from(area.width.saturating_sub(4)),
        ))
        .alignment(Alignment::Center)
        .style(Style::default().bg(PANEL).fg(TEXT))
        .block(panel_block(" REASONING EFFORT ", true)),
        area,
    );
}

fn centered_rect(area: Rect, maximum_width: u16, height: u16) -> Rect {
    let width = maximum_width.min(area.width.saturating_sub(2)).max(1);
    let height = height.min(area.height.saturating_sub(2)).max(1);
    Rect {
        x: area.x + area.width.saturating_sub(width) / 2,
        y: area.y + area.height.saturating_sub(height) / 2,
        width,
        height,
    }
}

fn effort_lines(selector: &EffortSelectorState, available_width: usize) -> Vec<Line<'static>> {
    let selected_index = selector
        .selected_index
        .min(selector.levels.len().saturating_sub(1));
    let segment_width = (available_width / selector.levels.len().max(1)).max(3);
    let mut marker_spans = Vec::with_capacity(selector.levels.len());
    let mut rail_spans = Vec::with_capacity(selector.levels.len());
    let mut label_spans = Vec::with_capacity(selector.levels.len());

    for (index, level) in selector.levels.iter().enumerate() {
        let selected = index == selected_index;
        marker_spans.push(Span::styled(
            format!("{:^segment_width$}", if selected { "▲" } else { "" }),
            Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
        ));
        rail_spans.push(Span::styled(
            "━".repeat(segment_width),
            Style::default().fg(if index <= selected_index {
                ACCENT
            } else {
                TEXT_FAINT
            }),
        ));
        label_spans.push(Span::styled(
            format!("{:^segment_width$}", effort_label(level)),
            if selected {
                Style::default().fg(ACCENT).add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(TEXT_MUTED)
            },
        ));
    }

    vec![
        Line::from(Span::styled(
            selector.model_id.clone(),
            Style::default().fg(TEXT_MUTED),
        )),
        Line::from(vec![
            Span::styled("Faster", Style::default().fg(TEXT)),
            Span::raw(" ".repeat(available_width.saturating_sub(13))),
            Span::styled("Smarter", Style::default().fg(TEXT)),
        ]),
        Line::from(marker_spans),
        Line::from(rail_spans),
        Line::from(label_spans),
        Line::from(""),
        Line::from(vec![
            Span::styled("←/→", Style::default().fg(ACCENT)),
            Span::styled(" adjust  ·  ", Style::default().fg(TEXT_FAINT)),
            Span::styled("Enter", Style::default().fg(ACCENT)),
            Span::styled(" confirm  ·  ", Style::default().fg(TEXT_FAINT)),
            Span::styled("Esc", Style::default().fg(ACCENT)),
            Span::styled(" cancel", Style::default().fg(TEXT_FAINT)),
        ]),
    ]
}

fn effort_label(value: &str) -> String {
    match value {
        "xhigh" => "xhigh".to_string(),
        value => value.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use ratatui::backend::TestBackend;
    use ratatui::Terminal;

    use super::*;
    use crate::test_support::initialized;

    #[test]
    fn effort_lines_render_selected_marker_and_labels() {
        let selector = EffortSelectorState {
            model_id: "openai/gpt-5.6-sol".to_string(),
            levels: vec!["low", "medium", "high", "xhigh", "max"]
                .into_iter()
                .map(str::to_string)
                .collect(),
            selected_index: 3,
        };
        let rendered = effort_lines(&selector, 70)
            .into_iter()
            .flat_map(|line| line.spans)
            .map(|span| span.content.into_owned())
            .collect::<String>();

        assert!(rendered.contains('▲'));
        assert!(rendered.contains("xhigh"));
        assert!(rendered.contains("Enter"));
    }

    #[test]
    fn render_effort_selector_draws_the_overlay() {
        let mut state = AppState::new(initialized(), Vec::new());
        state.effort_selector = Some(EffortSelectorState {
            model_id: "openai/gpt-5.6-sol".to_string(),
            levels: vec!["low".to_string(), "high".to_string()],
            selected_index: 1,
        });
        let backend = TestBackend::new(100, 30);
        let mut terminal = Terminal::new(backend).expect("terminal");

        terminal
            .draw(|frame| render_effort_selector(frame, &state))
            .expect("effort selector should render");

        let rendered = terminal.backend().buffer().clone();
        assert!(rendered.content.iter().any(|cell| cell.symbol() == "▲"));
    }
}
