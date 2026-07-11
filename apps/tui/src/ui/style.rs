use ratatui::style::{Color, Modifier, Style};
use ratatui::text::Span;
use ratatui::widgets::{Block, BorderType, Borders};

pub(super) const BG: Color = Color::Rgb(5, 9, 21);
pub(super) const PANEL: Color = Color::Rgb(9, 14, 27);
pub(super) const PANEL_ALT: Color = Color::Rgb(12, 18, 34);
pub(super) const BORDER: Color = Color::Rgb(47, 64, 92);
pub(super) const BORDER_FOCUS: Color = Color::Rgb(34, 211, 238);
pub(super) const TEXT: Color = Color::Rgb(226, 232, 240);
pub(super) const TEXT_MUTED: Color = Color::Rgb(148, 163, 184);
pub(super) const TEXT_FAINT: Color = Color::Rgb(100, 116, 139);
pub(super) const ACCENT: Color = Color::Rgb(56, 189, 248);
pub(super) const ACTION: Color = Color::Rgb(96, 165, 250);
pub(super) const WARN: Color = Color::Rgb(250, 204, 21);
pub(super) const DANGER: Color = Color::Rgb(248, 113, 113);
pub(super) const OK: Color = Color::Rgb(52, 211, 153);

pub(super) fn focused_block(title: &'static str, focused: bool) -> Block<'static> {
    panel_block(title, focused)
}

pub(super) fn panel_block(title: &'static str, focused: bool) -> Block<'static> {
    let border = if focused { BORDER_FOCUS } else { BORDER };
    let title_style = if focused {
        Style::default()
            .fg(BORDER_FOCUS)
            .add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(TEXT_MUTED)
    };
    Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(border).bg(PANEL))
        .style(Style::default().bg(PANEL))
        .title(Span::styled(title, title_style))
}

#[cfg(test)]
mod tests {
    use super::{focused_block, panel_block};

    #[test]
    fn block_helpers_build_focused_and_unfocused_panels() {
        let _focused = focused_block(" FOCUSED ", true);
        let _plain = panel_block(" PLAIN ", false);
    }
}
