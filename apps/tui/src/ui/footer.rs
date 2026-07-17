use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use ratatui::Frame;

use crate::state::AppState;

use super::layout::root_chunks;
use super::style::{action, panel_block, text, text_muted};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FooterAction {
    Submit,
    Cancel,
    Delete,
    ToggleSidebar,
    Dismiss,
}

pub fn footer_action_at(area: Rect, column: u16, row: u16) -> Option<FooterAction> {
    let footer_area = root_chunks(area)[3];
    let inner_row = footer_area.y.saturating_add(1);
    let inner_start = footer_area.x.saturating_add(1);
    let inner_end = footer_area
        .x
        .saturating_add(footer_area.width.saturating_sub(1));
    if row != inner_row || column < inner_start || column >= inner_end {
        return None;
    }

    let relative = column.saturating_sub(inner_start);
    for (start, end, action) in footer_action_ranges() {
        if relative >= start && relative < end {
            return Some(action);
        }
    }
    None
}

pub(super) fn footer_action_ranges() -> Vec<(u16, u16, FooterAction)> {
    let mut ranges = Vec::new();
    let mut column = 0_u16;
    for span in footer_spans() {
        let width = span.content.chars().count() as u16;
        if let Some(action) = footer_action_for_label(span.content.as_ref()) {
            ranges.push((column, column.saturating_add(width), action));
        }
        column = column.saturating_add(width);
    }
    ranges
}

pub(super) fn render_footer(frame: &mut Frame<'_>, area: Rect, state: &AppState) {
    let mut spans = footer_spans();
    if state.task_mode == crate::state::TaskMode::Code && state.active_thread().is_some() {
        spans.push(Span::raw("  "));
        spans.push(key_hint("[Ctrl-E] Tools"));
    }
    let footer = Paragraph::new(Line::from(spans))
        .style(Style::default().fg(text()))
        .block(panel_block(" CONTROLS ", false));
    frame.render_widget(footer, area);
}

fn footer_spans() -> Vec<Span<'static>> {
    vec![
        key_hint("[Enter] Submit"),
        Span::raw(" "),
        key_hint("[Ctrl-X] Cancel"),
        Span::raw(" "),
        key_hint("[Ctrl-D] Delete"),
        Span::raw(" "),
        key_hint("[Ctrl-B] Sidebar"),
        Span::raw("  "),
        Span::styled("Tab focus", Style::default().fg(text_muted())),
        Span::styled("  Up/Down select", Style::default().fg(text_muted())),
        Span::styled("  PgUp/PgDn", Style::default().fg(text_muted())),
        Span::raw("  "),
        key_hint("[Esc] Back"),
        Span::raw("  "),
        Span::styled(
            "Ctrl-C stop/quit  F1 keys  Ctrl-O editor",
            Style::default().fg(text_muted()),
        ),
    ]
}

fn key_hint(label: &'static str) -> Span<'static> {
    Span::styled(
        label,
        Style::default().fg(action()).add_modifier(Modifier::BOLD),
    )
}

fn footer_action_for_label(label: &str) -> Option<FooterAction> {
    match label {
        "[Enter] Submit" => Some(FooterAction::Submit),
        "[Ctrl-X] Cancel" => Some(FooterAction::Cancel),
        "[Ctrl-D] Delete" => Some(FooterAction::Delete),
        "[Ctrl-B] Sidebar" => Some(FooterAction::ToggleSidebar),
        "[Esc] Back" => Some(FooterAction::Dismiss),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use std::hint::black_box;
    use std::time::Instant;

    use ratatui::backend::TestBackend;
    use ratatui::layout::Rect;
    use ratatui::Terminal;

    use super::{footer_action_ranges, footer_spans, render_footer};
    use crate::state::AppState;
    use crate::test_support::initialized_default_capabilities;

    #[test]
    fn footer_spans_and_render_cover_control_surface() {
        let spans = footer_spans();
        assert!(spans.iter().any(|span| span.content.contains("Submit")));
        assert!(spans.iter().any(|span| span.content.contains("Sidebar")));
        assert_eq!(footer_action_ranges()[0].2, super::FooterAction::Submit);
        assert!(footer_action_ranges()
            .iter()
            .any(|(_, _, action)| *action == super::FooterAction::ToggleSidebar));
        assert_eq!(
            super::footer_action_at(Rect::new(0, 0, 120, 30), 0, 0),
            None
        );

        let state = AppState::new(initialized_default_capabilities(), Vec::new());
        let backend = TestBackend::new(220, 3);
        let mut terminal = Terminal::new(backend).expect("terminal");
        terminal
            .draw(|frame| render_footer(frame, frame.area(), &state))
            .expect("footer should render");

        let mut code_state = state;
        code_state.task_mode = crate::state::TaskMode::Code;
        code_state.set_active_thread(
            serde_json::from_value(serde_json::json!({
                "id":"thread", "title":"Task", "objective":"Objective", "state":"active",
                "archived":false, "source":"test", "taskMode":"code", "parentThreadId":null,
                "turns":[], "createdAt":1, "updatedAt":1
            }))
            .expect("thread"),
        );
        terminal
            .draw(|frame| render_footer(frame, frame.area(), &code_state))
            .expect("code footer should render");
        let rendered = terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(|cell| cell.symbol())
            .collect::<String>();
        assert!(rendered.contains("Tools"));
    }

    #[test]
    #[ignore = "performance baseline: run explicitly with --ignored --nocapture"]
    fn perf_footer_segments_and_ranges() {
        const ITERATIONS: usize = 250_000;

        let started = Instant::now();
        for _ in 0..ITERATIONS {
            black_box(footer_spans());
            black_box(footer_action_ranges());
        }
        let elapsed = started.elapsed();
        let operations = ITERATIONS * 2;
        let avg_nanos = elapsed.as_nanos() / operations as u128;
        eprintln!(
            "perf_footer_segments_and_ranges: operations={operations} total_ms={:.3} avg_ns={avg_nanos}",
            elapsed.as_secs_f64() * 1_000.0
        );
    }
}
