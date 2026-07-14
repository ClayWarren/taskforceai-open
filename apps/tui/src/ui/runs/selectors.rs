use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};

use crate::app::format::trim_float;
use crate::state::AppState;

use super::super::style::{ACCENT, BG, BORDER_FOCUS, OK, TEXT, TEXT_FAINT, TEXT_MUTED};

pub(in crate::ui) fn model_selector_scroll(area: Rect, state: &AppState) -> u16 {
    let visible_rows = area.height.saturating_sub(2);
    if visible_rows == 0 {
        return 0;
    }
    let selected_line = state
        .model_selector
        .as_ref()
        .map(model_selector_selected_line)
        .unwrap_or(0);
    let visible_rows = usize::from(visible_rows);
    selected_line
        .saturating_sub(visible_rows.saturating_sub(1))
        .min(usize::from(u16::MAX)) as u16
}

fn model_selector_selected_line(selector: &crate::state::ModelSelectorState) -> usize {
    let prior_option_lines = selector
        .options
        .iter()
        .take(selector.selected_index)
        .map(|option| {
            1 + usize::from(
                option
                    .description
                    .as_ref()
                    .is_some_and(|description| !description.is_empty()),
            )
        })
        .sum::<usize>();
    3 + prior_option_lines
}

pub(in crate::ui) fn model_selector_lines(state: &AppState) -> Vec<Line<'_>> {
    let Some(selector) = &state.model_selector else {
        return vec![Line::from("No models loaded.")];
    };
    let catalog = if selector.remote_catalog {
        "remote"
    } else {
        "local"
    };
    let selected = selector
        .selected_model_id
        .as_deref()
        .unwrap_or(&selector.default_model_id);
    let mut lines = Vec::with_capacity(3 + selector.options.len().saturating_mul(2));
    lines.push(Line::from(vec![
        Span::styled(
            "Model selector",
            Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            "  Up/Down choose, Enter select, Esc close",
            Style::default().fg(TEXT_FAINT),
        ),
    ]));
    lines.push(Line::from(vec![
        Span::styled("current ", Style::default().fg(TEXT_FAINT)),
        Span::styled(selected, Style::default().fg(ACCENT)),
        Span::styled("  catalog ", Style::default().fg(TEXT_FAINT)),
        Span::styled(catalog, Style::default().fg(TEXT_MUTED)),
    ]));
    lines.push(Line::raw(""));

    for (index, option) in selector.options.iter().enumerate() {
        let highlighted = selector.selected_index == index;
        let active = selected == option.id.as_str();
        let marker = match (highlighted, active) {
            (true, true) => "> *",
            (true, false) => ">  ",
            (false, true) => "  *",
            (false, false) => "   ",
        };
        let style = if highlighted {
            Style::default()
                .fg(BG)
                .bg(BORDER_FOCUS)
                .add_modifier(Modifier::BOLD)
        } else if active {
            Style::default().fg(OK).add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(TEXT)
        };
        let mut label =
            Vec::with_capacity(6 + usize::from(option.usage_multiple.is_some()).saturating_mul(3));
        label.push(Span::styled(marker, style));
        label.push(Span::styled(" ", style));
        label.push(Span::styled(option.id.as_str(), style));
        label.push(Span::styled(" [", style));
        label.push(Span::styled(option.badge.as_str(), style));
        label.push(Span::styled("]", style));
        if let Some(usage) = option.usage_multiple {
            label.push(Span::styled(" ", style));
            label.push(Span::styled(trim_float(usage), style));
            label.push(Span::styled("x", style));
        }
        lines.push(Line::from(label));
        if let Some(description) = &option.description {
            if !description.is_empty() {
                let style = Style::default().fg(TEXT_MUTED);
                lines.push(Line::from(vec![
                    Span::styled("    ", style),
                    Span::styled(description.as_str(), style),
                ]));
            }
        }
    }
    lines
}

pub(in crate::ui) fn command_palette_scroll(area: Rect, state: &AppState) -> u16 {
    let visible_rows = area.height.saturating_sub(2);
    if visible_rows == 0 {
        return 0;
    }
    let selected_line = state
        .selected_command_suggestion
        .unwrap_or(0)
        .saturating_add(2);
    let visible_rows = usize::from(visible_rows);
    selected_line
        .saturating_sub(visible_rows.saturating_sub(1))
        .min(usize::from(u16::MAX)) as u16
}

pub(super) fn command_palette_lines(state: &AppState) -> Vec<Line<'_>> {
    let mut lines = vec![
        Line::from(vec![
            Span::styled(
                "Slash commands",
                Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                "  Up/Down select, Enter run",
                Style::default().fg(TEXT_FAINT),
            ),
        ]),
        Line::raw(""),
    ];

    for (index, command) in state.command_suggestions.iter().enumerate() {
        let selected = state.selected_command_suggestion == Some(index);
        let marker = if selected { ">" } else { " " };
        let style = if selected {
            Style::default()
                .fg(BG)
                .bg(BORDER_FOCUS)
                .add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(TEXT)
        };
        lines.push(Line::from(vec![
            Span::styled(format!("{marker} "), Style::default().fg(ACCENT)),
            Span::styled(*command, style),
        ]));
    }

    lines
}
