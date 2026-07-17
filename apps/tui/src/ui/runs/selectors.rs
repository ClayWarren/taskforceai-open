use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};

#[cfg(test)]
use crate::app::format::trim_float;
use crate::state::AppState;

#[cfg(test)]
use super::super::style::ok;
use super::super::style::{accent, bg, border_focus, text, text_faint, text_muted};

pub(in crate::ui) fn picker_scroll(area: Rect, state: &AppState) -> u16 {
    let visible_rows = usize::from(area.height.saturating_sub(2)).max(1);
    state
        .picker
        .as_ref()
        .map(|picker| picker.selected_index.saturating_mul(2).saturating_add(3))
        .unwrap_or(0)
        .saturating_sub(visible_rows.saturating_sub(2))
        .min(usize::from(u16::MAX)) as u16
}

pub(in crate::ui) fn picker_lines(state: &AppState) -> Vec<Line<'_>> {
    let Some(picker) = &state.picker else {
        return vec![Line::from("No picker is open.")];
    };
    let mut lines = vec![
        Line::from(vec![
            Span::styled(
                picker.title.as_str(),
                Style::default().fg(accent()).add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                "  type to filter · Up/Down choose · Enter select · Esc cancel",
                Style::default().fg(text_faint()),
            ),
        ]),
        Line::from(vec![
            Span::styled("filter ", Style::default().fg(text_faint())),
            Span::styled(
                if picker.query.is_empty() {
                    "all"
                } else {
                    picker.query.as_str()
                },
                Style::default().fg(accent()),
            ),
        ]),
        Line::raw(""),
    ];
    let filtered = picker.filtered_indices();
    if filtered.is_empty() {
        lines.push(Line::styled(
            "No matching options.",
            Style::default().fg(text_muted()),
        ));
        return lines;
    }
    for (filtered_index, option_index) in filtered.into_iter().enumerate() {
        let option = &picker.options[option_index];
        let selected = filtered_index == picker.selected_index;
        let style = if selected {
            Style::default()
                .fg(bg())
                .bg(border_focus())
                .add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(text())
        };
        lines.push(Line::from(vec![
            Span::styled(if selected { "> " } else { "  " }, style),
            Span::styled(option.title.as_str(), style),
        ]));
        lines.push(Line::from(vec![
            Span::styled("    ", Style::default()),
            Span::styled(option.detail.as_str(), Style::default().fg(text_muted())),
        ]));
    }
    lines
}

#[cfg(test)]
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

#[cfg(test)]
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

#[cfg(test)]
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
            Style::default().fg(accent()).add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            "  Up/Down choose, Enter select, Esc close",
            Style::default().fg(text_faint()),
        ),
    ]));
    lines.push(Line::from(vec![
        Span::styled("current ", Style::default().fg(text_faint())),
        Span::styled(selected, Style::default().fg(accent())),
        Span::styled("  catalog ", Style::default().fg(text_faint())),
        Span::styled(catalog, Style::default().fg(text_muted())),
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
                .fg(bg())
                .bg(border_focus())
                .add_modifier(Modifier::BOLD)
        } else if active {
            Style::default().fg(ok()).add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(text())
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
                let style = Style::default().fg(text_muted());
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
                Style::default().fg(accent()).add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                "  Up/Down select, Enter run",
                Style::default().fg(text_faint()),
            ),
        ]),
        Line::raw(""),
    ];

    for (index, command) in state.command_suggestions.iter().enumerate() {
        let selected = state.selected_command_suggestion == Some(index);
        let marker = if selected { ">" } else { " " };
        let style = if selected {
            Style::default()
                .fg(bg())
                .bg(border_focus())
                .add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(text())
        };
        lines.push(Line::from(vec![
            Span::styled(format!("{marker} "), Style::default().fg(accent())),
            Span::styled(*command, style),
            Span::styled(
                format!("  {}", crate::state::commands::command_description(command)),
                Style::default().fg(text_faint()),
            ),
        ]));
    }

    lines
}
