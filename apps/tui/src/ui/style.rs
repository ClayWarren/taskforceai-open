use std::borrow::Cow;
use std::sync::atomic::{AtomicU32, AtomicU8, Ordering};

use ratatui::style::{Color, Modifier, Style};
use ratatui::text::Span;
use ratatui::widgets::{Block, BorderType, Borders};

static BG_VALUE: AtomicU32 = AtomicU32::new(rgb(5, 9, 21));
static PANEL_VALUE: AtomicU32 = AtomicU32::new(rgb(9, 14, 27));
static PANEL_ALT_VALUE: AtomicU32 = AtomicU32::new(rgb(12, 18, 34));
static BORDER_VALUE: AtomicU32 = AtomicU32::new(rgb(47, 64, 92));
static BORDER_FOCUS_VALUE: AtomicU32 = AtomicU32::new(rgb(34, 211, 238));
static TEXT_VALUE: AtomicU32 = AtomicU32::new(rgb(226, 232, 240));
static TEXT_MUTED_VALUE: AtomicU32 = AtomicU32::new(rgb(148, 163, 184));
static TEXT_FAINT_VALUE: AtomicU32 = AtomicU32::new(rgb(100, 116, 139));
static ACCENT_VALUE: AtomicU32 = AtomicU32::new(rgb(56, 189, 248));
static ACTION_VALUE: AtomicU32 = AtomicU32::new(rgb(96, 165, 250));
static WARN_VALUE: AtomicU32 = AtomicU32::new(rgb(250, 204, 21));
static DANGER_VALUE: AtomicU32 = AtomicU32::new(rgb(248, 113, 113));
static OK_VALUE: AtomicU32 = AtomicU32::new(rgb(52, 211, 153));
static COLOR_LEVEL: AtomicU8 = AtomicU8::new(0);

const fn rgb(red: u8, green: u8, blue: u8) -> u32 {
    ((red as u32) << 16) | ((green as u32) << 8) | blue as u32
}

fn color(value: &AtomicU32) -> Color {
    let value = value.load(Ordering::Relaxed);
    let red = (value >> 16) as u8;
    let green = (value >> 8) as u8;
    let blue = value as u8;
    match COLOR_LEVEL.load(Ordering::Relaxed) {
        1 => Color::Indexed(xterm_index(red, green, blue)),
        2 => Color::Indexed(ansi16_index(red, green, blue)),
        _ => Color::Rgb(red, green, blue),
    }
}

// coverage:ignore-start -- inspects live terminal environment and host appearance settings.
pub(crate) fn apply_terminal_profile() -> &'static str {
    let term = std::env::var("TERM")
        .unwrap_or_default()
        .to_ascii_lowercase();
    let color_term = std::env::var("COLORTERM")
        .unwrap_or_default()
        .to_ascii_lowercase();
    let level = if term == "dumb" || std::env::var_os("NO_COLOR").is_some() {
        2
    } else if color_term.contains("truecolor") || color_term.contains("24bit") {
        0
    } else if term.contains("256color") {
        1
    } else {
        0
    };
    COLOR_LEVEL.store(level, Ordering::Relaxed);

    if terminal_appearance_is_light() {
        set_palette([
            [245, 247, 250],
            [255, 255, 255],
            [235, 239, 245],
            [148, 163, 184],
            [2, 132, 199],
            [15, 23, 42],
            [71, 85, 105],
            [100, 116, 139],
            [2, 132, 199],
            [29, 78, 216],
            [161, 98, 7],
            [185, 28, 28],
            [4, 120, 87],
        ]);
        "auto-light"
    } else {
        "taskforce-dark"
    }
}

fn terminal_appearance_is_light() -> bool {
    if let Ok(value) = std::env::var("TASKFORCEAI_TERMINAL_APPEARANCE") {
        return value.eq_ignore_ascii_case("light");
    }
    if let Ok(value) = std::env::var("COLORFGBG") {
        if let Some(background) = value
            .rsplit(';')
            .next()
            .and_then(|value| value.parse::<u8>().ok())
        {
            return matches!(background, 7 | 10..=15);
        }
    }
    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("defaults")
            .args(["read", "-g", "AppleInterfaceStyle"])
            .output();
        if let Ok(output) = output {
            return !output.status.success()
                || !String::from_utf8_lossy(&output.stdout)
                    .trim()
                    .eq_ignore_ascii_case("dark");
        }
    }
    false
}
// coverage:ignore-end

fn xterm_index(red: u8, green: u8, blue: u8) -> u8 {
    fn component(value: u8) -> u8 {
        if value < 48 {
            0
        } else if value < 115 {
            1
        } else {
            ((value - 35) / 40).min(5)
        }
    }
    16 + 36 * component(red) + 6 * component(green) + component(blue)
}

fn ansi16_index(red: u8, green: u8, blue: u8) -> u8 {
    let bright = red.max(green).max(blue) >= 180;
    let mut index = 0;
    if red >= 96 {
        index |= 1;
    }
    if green >= 96 {
        index |= 2;
    }
    if blue >= 96 {
        index |= 4;
    }
    if bright && index != 0 {
        index + 8
    } else {
        index
    }
}

pub(crate) fn bg() -> Color {
    color(&BG_VALUE)
}

pub(crate) fn panel() -> Color {
    color(&PANEL_VALUE)
}

pub(crate) fn panel_alt() -> Color {
    color(&PANEL_ALT_VALUE)
}

pub(crate) fn border() -> Color {
    color(&BORDER_VALUE)
}

pub(crate) fn border_focus() -> Color {
    color(&BORDER_FOCUS_VALUE)
}

pub(crate) fn text() -> Color {
    color(&TEXT_VALUE)
}

pub(crate) fn text_muted() -> Color {
    color(&TEXT_MUTED_VALUE)
}

pub(crate) fn text_faint() -> Color {
    color(&TEXT_FAINT_VALUE)
}

pub(crate) fn accent() -> Color {
    color(&ACCENT_VALUE)
}

pub(crate) fn action() -> Color {
    color(&ACTION_VALUE)
}

pub(crate) fn warn() -> Color {
    color(&WARN_VALUE)
}

pub(crate) fn danger() -> Color {
    color(&DANGER_VALUE)
}

pub(crate) fn ok() -> Color {
    color(&OK_VALUE)
}

pub(crate) fn set_palette(colors: [[u8; 3]; 13]) {
    for (target, value) in [
        &BG_VALUE,
        &PANEL_VALUE,
        &PANEL_ALT_VALUE,
        &BORDER_VALUE,
        &BORDER_FOCUS_VALUE,
        &TEXT_VALUE,
        &TEXT_MUTED_VALUE,
        &TEXT_FAINT_VALUE,
        &ACCENT_VALUE,
        &ACTION_VALUE,
        &WARN_VALUE,
        &DANGER_VALUE,
        &OK_VALUE,
    ]
    .into_iter()
    .zip(colors)
    {
        target.store(rgb(value[0], value[1], value[2]), Ordering::Relaxed);
    }
}

pub(super) fn panel_block(title: impl Into<Cow<'static, str>>, focused: bool) -> Block<'static> {
    let border = if focused { border_focus() } else { border() };
    let title_style = if focused {
        Style::default()
            .fg(border_focus())
            .add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(text_muted())
    };
    Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(border).bg(panel()))
        .style(Style::default().bg(panel()))
        .title(Span::styled(title, title_style))
}

#[cfg(test)]
mod tests {
    use ratatui::style::Color;

    use super::*;

    #[test]
    fn block_helpers_build_focused_and_unfocused_panels() {
        let _focused = panel_block(" FOCUSED ", true);
        let _plain = panel_block(" PLAIN ", false);

        COLOR_LEVEL.store(0, Ordering::Relaxed);
        set_palette([[1, 2, 3]; 13]);
        for color in [
            bg(),
            panel(),
            panel_alt(),
            border(),
            border_focus(),
            text(),
            text_muted(),
            text_faint(),
            accent(),
            action(),
            warn(),
            danger(),
            ok(),
        ] {
            assert_eq!(color, Color::Rgb(1, 2, 3));
        }

        assert_eq!(xterm_index(0, 47, 114), 17);
        assert_eq!(xterm_index(115, 255, 255), 123);
        assert_eq!(ansi16_index(0, 0, 0), 0);
        assert_eq!(ansi16_index(200, 0, 0), 9);
        assert_eq!(ansi16_index(100, 100, 100), 7);
        COLOR_LEVEL.store(1, Ordering::Relaxed);
        assert!(matches!(bg(), Color::Indexed(_)));
        COLOR_LEVEL.store(2, Ordering::Relaxed);
        assert!(matches!(bg(), Color::Indexed(_)));
        COLOR_LEVEL.store(0, Ordering::Relaxed);
    }
}
