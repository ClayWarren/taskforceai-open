use std::borrow::Cow;

use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Padding, Paragraph};
use ratatui::Frame;

use crate::state::AppState;

use super::style::{panel_block, ACCENT, OK, PANEL, TEXT, TEXT_FAINT, TEXT_MUTED, WARN};

pub(super) fn render_header(frame: &mut Frame<'_>, area: Rect, state: &AppState) {
    let capabilities = &state.initialized.capabilities;
    let mut session_details = vec![
        capability_chip("cap:runs", capabilities.runs),
        capability_chip("cap:sync", capabilities.sync),
        capability_chip("cap:mcp", capabilities.mcp),
        capability_chip("cap:skills", capabilities.skills),
        capability_chip("cap:browser", capabilities.browser),
        capability_chip("cap:computer", capabilities.computer_use),
        private_chat_chip(state.private_chat_enabled),
        Span::styled("  model:", Style::default().fg(TEXT_FAINT)),
        Span::styled(
            compact_model_id(&state.current_model_id),
            Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
        ),
    ];
    if let Some(effort) = &state.reasoning_effort {
        session_details.extend([
            Span::styled("  effort:", Style::default().fg(TEXT_FAINT)),
            Span::styled(
                effort.clone(),
                Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
            ),
        ]);
    }
    let lines = vec![
        Line::from(vec![
            Span::styled(
                "TaskForceAI",
                Style::default().fg(TEXT).add_modifier(Modifier::BOLD),
            ),
            Span::styled(" TUI", Style::default().fg(ACCENT)),
            Span::styled("  |  ", Style::default().fg(TEXT_FAINT)),
            Span::styled(&state.status_line, Style::default().fg(WARN)),
            Span::styled("  |  ", Style::default().fg(TEXT_FAINT)),
            companion_span(state),
        ]),
        Line::from(session_details),
    ];
    frame.render_widget(
        Paragraph::new(lines)
            .style(Style::default().fg(TEXT))
            .block(
                panel_block(" SESSION ", false)
                    .style(Style::default().bg(PANEL))
                    .padding(Padding::horizontal(1)),
            ),
        area,
    );
}

fn companion_span(state: &AppState) -> Span<'_> {
    if !state.pet.visible {
        return Span::styled("companion:hidden", Style::default().fg(TEXT_FAINT));
    }
    let frames = companion_frames(&state.pet.mood);
    let frame = frames[(state.animation_frame as usize) % frames.len()];
    let label = format!("{} {}", frame, compact_pet_name(&state.pet.name));
    let style = match state.pet.mood.as_str() {
        "celebrate" => Style::default().fg(OK).add_modifier(Modifier::BOLD),
        "alert" => Style::default().fg(WARN).add_modifier(Modifier::BOLD),
        "idle" => Style::default().fg(TEXT_MUTED),
        _ => Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
    };
    Span::styled(label, style)
}

fn companion_frames(mood: &str) -> &'static [&'static str] {
    match mood {
        "celebrate" => &["\\o/", "-o-", "/o\\"],
        "alert" => &["[!]", "<!>", "[!]"],
        "idle" => &["(-)", "(.)", "(-)", "(.)"],
        _ => &["<*>", "<+>", "<*>", "<x>"],
    }
}

fn compact_pet_name(name: &str) -> Cow<'_, str> {
    const MAX: usize = 16;
    let name = name.trim();
    if name.chars().count() <= MAX {
        return Cow::Borrowed(name);
    }
    let mut output = name.chars().take(MAX.saturating_sub(3)).collect::<String>();
    output.push_str("...");
    Cow::Owned(output)
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

fn capability_chip(label: &'static str, enabled: bool) -> Span<'static> {
    let style = if enabled {
        Style::default().fg(OK)
    } else {
        Style::default().fg(TEXT_FAINT)
    };
    Span::styled(capability_label(label, enabled), style)
}

fn private_chat_chip(enabled: bool) -> Span<'static> {
    if enabled {
        Span::styled(
            "[private:on] ",
            Style::default().fg(WARN).add_modifier(Modifier::BOLD),
        )
    } else {
        Span::raw("")
    }
}

fn capability_label(label: &'static str, enabled: bool) -> Cow<'static, str> {
    match (label, enabled) {
        ("cap:runs", true) => Cow::Borrowed("[cap:runs:available] "),
        ("cap:runs", false) => Cow::Borrowed("[cap:runs:unavailable] "),
        ("cap:sync", true) => Cow::Borrowed("[cap:sync:available] "),
        ("cap:sync", false) => Cow::Borrowed("[cap:sync:unavailable] "),
        ("cap:mcp", true) => Cow::Borrowed("[cap:mcp:available] "),
        ("cap:mcp", false) => Cow::Borrowed("[cap:mcp:unavailable] "),
        ("cap:skills", true) => Cow::Borrowed("[cap:skills:available] "),
        ("cap:skills", false) => Cow::Borrowed("[cap:skills:unavailable] "),
        ("cap:browser", true) => Cow::Borrowed("[cap:browser:available] "),
        ("cap:browser", false) => Cow::Borrowed("[cap:browser:unavailable] "),
        ("cap:computer", true) => Cow::Borrowed("[cap:computer:available] "),
        ("cap:computer", false) => Cow::Borrowed("[cap:computer:unavailable] "),
        _ => Cow::Owned(format!(
            "[{}:{}] ",
            label,
            if enabled { "available" } else { "unavailable" }
        )),
    }
}

#[cfg(test)]
mod tests {
    use ratatui::backend::TestBackend;
    use ratatui::Terminal;
    use taskforceai_app_protocol::PetState;

    use super::{
        capability_chip, compact_model_id, companion_span, private_chat_chip, render_header,
    };
    use crate::state::AppState;
    use crate::test_support::initialized;

    #[test]
    fn companion_span_respects_visibility_mood_and_name_length() {
        let mut state = AppState::new(initialized(), Vec::new());
        state.pet = PetState {
            name: "Very Long Companion Name".to_string(),
            mood: "alert".to_string(),
            visible: true,
            message: "watching".to_string(),
        };
        state.animation_frame = 1;

        assert_eq!(companion_span(&state).content, "<!> Very Long Com...");

        state.pet.visible = false;
        assert_eq!(companion_span(&state).content, "companion:hidden");
    }

    #[test]
    fn capability_chip_labels_availability() {
        assert_eq!(
            capability_chip("cap:browser", true).content,
            "[cap:browser:available] "
        );
        assert_eq!(
            capability_chip("cap:browser", false).content,
            "[cap:browser:unavailable] "
        );
        assert_eq!(
            capability_chip("cap:unknown", true).content,
            "[cap:unknown:available] "
        );
        assert_eq!(
            capability_chip("cap:runs", false).content,
            "[cap:runs:unavailable] "
        );
        assert_eq!(
            capability_chip("cap:sync", false).content,
            "[cap:sync:unavailable] "
        );
        assert_eq!(
            capability_chip("cap:mcp", false).content,
            "[cap:mcp:unavailable] "
        );
        assert_eq!(
            capability_chip("cap:skills", false).content,
            "[cap:skills:unavailable] "
        );
        assert_eq!(
            capability_chip("cap:computer", false).content,
            "[cap:computer:unavailable] "
        );
    }

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
        let backend = TestBackend::new(100, 4);
        let mut terminal = Terminal::new(backend).expect("terminal");

        terminal
            .draw(|frame| render_header(frame, frame.area(), &state))
            .expect("header should render");
    }

    #[test]
    #[ignore = "performance baseline: run explicitly with --ignored --nocapture"]
    fn perf_header_chrome_helpers() {
        const ITERATIONS: usize = 250_000;
        let mut state = AppState::new(initialized(), Vec::new());
        state.current_model_id = "openai/gpt-5.6-sol".to_string();

        let started = std::time::Instant::now();
        for frame in 0..ITERATIONS {
            state.animation_frame = frame as u64;
            std::hint::black_box(companion_span(&state));
            std::hint::black_box(compact_model_id(&state.current_model_id));
            std::hint::black_box(capability_chip("cap:runs", true));
            std::hint::black_box(capability_chip("cap:sync", true));
            std::hint::black_box(capability_chip("cap:mcp", true));
            std::hint::black_box(capability_chip("cap:skills", true));
            std::hint::black_box(capability_chip("cap:browser", true));
            std::hint::black_box(capability_chip("cap:computer", true));
        }
        let elapsed = started.elapsed();
        let operations = ITERATIONS * 8;
        let avg_nanos = elapsed.as_nanos() / operations as u128;
        eprintln!(
            "perf_header_chrome_helpers: operations={operations} total_ms={:.3} avg_ns={avg_nanos}",
            elapsed.as_secs_f64() * 1_000.0
        );
    }
}
