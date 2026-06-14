use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Padding, Paragraph};
use ratatui::Frame;

use crate::state::AppState;

use super::style::{panel_block, ACCENT, OK, PANEL, TEXT, TEXT_FAINT, TEXT_MUTED, WARN};

pub(super) fn render_header(frame: &mut Frame<'_>, area: Rect, state: &AppState) {
    let capabilities = &state.initialized.capabilities;
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
        Line::from(vec![
            capability_chip("cap:runs", capabilities.runs),
            capability_chip("cap:sync", capabilities.sync),
            capability_chip("cap:mcp", capabilities.mcp),
            capability_chip("cap:skills", capabilities.skills),
            capability_chip("cap:browser", capabilities.browser),
            capability_chip("cap:computer", capabilities.computer_use),
            Span::styled("  model:", Style::default().fg(TEXT_FAINT)),
            Span::styled(
                compact_model_id(&state.current_model_id),
                Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
            ),
        ]),
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

fn companion_span(state: &AppState) -> Span<'static> {
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

fn compact_pet_name(name: &str) -> String {
    const MAX: usize = 16;
    let name = name.trim();
    if name.chars().count() <= MAX {
        return name.to_string();
    }
    let mut output = name.chars().take(MAX.saturating_sub(3)).collect::<String>();
    output.push_str("...");
    output
}

pub(super) fn compact_model_id(model_id: &str) -> String {
    const MAX: usize = 28;
    let model_id = model_id.trim();
    if model_id.is_empty() {
        return "default".to_string();
    }
    if model_id.chars().count() <= MAX {
        return model_id.to_string();
    }
    let mut output = model_id
        .chars()
        .take(MAX.saturating_sub(3))
        .collect::<String>();
    output.push_str("...");
    output
}

fn capability_chip(label: &'static str, enabled: bool) -> Span<'static> {
    let style = if enabled {
        Style::default().fg(OK)
    } else {
        Style::default().fg(TEXT_FAINT)
    };
    Span::styled(
        format!(
            "[{}:{}] ",
            label,
            if enabled { "available" } else { "unavailable" }
        ),
        style,
    )
}

#[cfg(test)]
mod tests {
    use taskforceai_app_protocol::{
        Capabilities, InitializeResult, PetState, ServerInfo, TransportInfo,
    };

    use super::{capability_chip, companion_span};
    use crate::state::AppState;

    fn initialized() -> InitializeResult {
        InitializeResult {
            server: ServerInfo::default(),
            transport: TransportInfo {
                kind: "stdio".to_string(),
                encoding: "jsonl".to_string(),
            },
            capabilities: Capabilities {
                auth: true,
                runs: true,
                history: true,
                pending_prompts: true,
                projects: true,
                attachments: true,
                context: true,
                memory: true,
                mcp: true,
                sync: true,
                events: true,
                skills: true,
                plugins: true,
                computer_use: true,
                browser: true,
                agent_sessions: true,
                threads: true,
                turns: true,
                diagnostics: true,
                channels: true,
                schedules: true,
                workflows: true,
            },
        }
    }

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
    }
}
