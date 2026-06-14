use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use ratatui::Frame;

use crate::state::AppState;

use super::layout::root_chunks;
use super::style::{panel_block, ACTION, TEXT, TEXT_MUTED};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FooterAction {
    Submit,
    Cancel,
    Delete,
    Quit,
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

pub(super) fn footer_action_ranges() -> [(u16, u16, FooterAction); 4] {
    let mut ranges = [(0, 0, FooterAction::Submit); 4];
    let mut range_index = 0;
    let mut column = 0_u16;
    for segment in footer_segments() {
        let width = segment_width(&segment.span);
        if let Some(action) = segment.action {
            ranges[range_index] = (column, column.saturating_add(width), action);
            range_index += 1;
        }
        column = column.saturating_add(width);
    }
    ranges
}

pub(super) fn render_footer(frame: &mut Frame<'_>, area: Rect, _state: &AppState) {
    let footer = Paragraph::new(Line::from(
        footer_segments()
            .into_iter()
            .map(|segment| segment.span)
            .collect::<Vec<_>>(),
    ))
    .style(Style::default().fg(TEXT))
    .block(panel_block(" CONTROLS ", false));
    frame.render_widget(footer, area);
}

struct FooterSegment {
    span: Span<'static>,
    action: Option<FooterAction>,
}

fn footer_segments() -> Vec<FooterSegment> {
    vec![
        footer_action_segment(key_hint("Enter", "Submit"), FooterAction::Submit),
        footer_text_segment(Span::raw(" ")),
        footer_action_segment(key_hint("Ctrl-X", "Cancel"), FooterAction::Cancel),
        footer_text_segment(Span::raw(" ")),
        footer_action_segment(key_hint("Ctrl-D", "Delete"), FooterAction::Delete),
        footer_text_segment(Span::raw("  ")),
        footer_text_segment(Span::styled("Tab focus", Style::default().fg(TEXT_MUTED))),
        footer_text_segment(Span::styled(
            "  Up/Down or j/k select",
            Style::default().fg(TEXT_MUTED),
        )),
        footer_text_segment(Span::styled(
            "  PgUp/PgDn scroll",
            Style::default().fg(TEXT_MUTED),
        )),
        footer_text_segment(Span::raw("  ")),
        footer_action_segment(key_hint("Esc", "Quit"), FooterAction::Quit),
    ]
}

fn footer_action_segment(span: Span<'static>, action: FooterAction) -> FooterSegment {
    FooterSegment {
        span,
        action: Some(action),
    }
}

fn footer_text_segment(span: Span<'static>) -> FooterSegment {
    FooterSegment { span, action: None }
}

fn segment_width(span: &Span<'_>) -> u16 {
    span.content.chars().count().min(u16::MAX as usize) as u16
}

fn key_hint(key: &'static str, label: &'static str) -> Span<'static> {
    Span::styled(
        format!("[{key}] {label}"),
        Style::default().fg(ACTION).add_modifier(Modifier::BOLD),
    )
}
