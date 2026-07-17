use ratatui::layout::{Alignment, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use ratatui::Frame;

use crate::state::{AppState, AuthUiState};

use super::composer::render_launch_composer;
use super::header::{agent_topology_label, compact_model_id, effective_reasoning_effort};
use super::style::{accent, action, danger, text, text_faint, text_muted};

pub(super) fn render_launch(frame: &mut Frame<'_>, area: Rect, state: &AppState) {
    let content = launch_content_area(area);
    if content.height < 10 || content.width < 20 {
        render_launch_composer(frame, area, state);
        return;
    }

    let brand = Rect::new(content.x, content.y, content.width, 3.min(content.height));
    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled(
                "TaskForce",
                Style::default().fg(text()).add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                "AI",
                Style::default().fg(accent()).add_modifier(Modifier::BOLD),
            ),
        ]))
        .alignment(Alignment::Center),
        brand,
    );

    let model_y = content.y.saturating_add(3);
    let mut model_details = vec![
        Span::styled(
            state.task_mode.label(),
            Style::default().fg(accent()).add_modifier(Modifier::BOLD),
        ),
        Span::styled("  ·  ", Style::default().fg(text_faint())),
        Span::styled("model ", Style::default().fg(text_faint())),
        Span::styled(
            compact_model_id(&state.current_model_id),
            Style::default().fg(text()).add_modifier(Modifier::BOLD),
        ),
    ];
    if let Some(effort) = effective_reasoning_effort(state) {
        model_details.extend([
            Span::styled("  ·  effort ", Style::default().fg(text_faint())),
            Span::styled(
                effort.to_string(),
                Style::default().fg(text()).add_modifier(Modifier::BOLD),
            ),
        ]);
    }
    model_details.extend([
        Span::styled("  ·  ", Style::default().fg(text_faint())),
        Span::styled(
            agent_topology_label(state),
            Style::default().fg(text()).add_modifier(Modifier::BOLD),
        ),
    ]);
    frame.render_widget(
        Paragraph::new(Line::from(model_details)).alignment(Alignment::Center),
        Rect::new(content.x, model_y, content.width, 1),
    );

    if state.auth_ui_state() != AuthUiState::SignedIn {
        render_launch_auth(frame, content, model_y.saturating_add(2), state);
        return;
    }

    let composer_y = model_y.saturating_add(2);
    let composer_height = content
        .y
        .saturating_add(content.height)
        .saturating_sub(composer_y)
        .clamp(3, 5);
    render_launch_composer(
        frame,
        Rect::new(content.x, composer_y, content.width, composer_height),
        state,
    );

    let hints_y = composer_y.saturating_add(composer_height).saturating_add(1);
    if hints_y < area.y.saturating_add(area.height) {
        frame.render_widget(
            Paragraph::new(Line::from(vec![
                Span::styled(
                    "Enter",
                    Style::default().fg(action()).add_modifier(Modifier::BOLD),
                ),
                Span::styled(" send  ·  ", Style::default().fg(text_faint())),
                Span::styled("/model", Style::default().fg(action())),
                Span::styled(" change model  ·  ", Style::default().fg(text_faint())),
                Span::styled("/resume", Style::default().fg(action())),
                Span::styled(" conversations  ·  ", Style::default().fg(text_faint())),
                Span::styled("/", Style::default().fg(action())),
                Span::styled(" commands", Style::default().fg(text_faint())),
            ]))
            .alignment(Alignment::Center),
            Rect::new(content.x, hints_y, content.width, 1),
        );
    }
}

fn render_launch_auth(frame: &mut Frame<'_>, content: Rect, auth_y: u16, state: &AppState) {
    let mut centered = |line: Line<'static>, y| {
        frame.render_widget(
            Paragraph::new(line).alignment(Alignment::Center),
            Rect::new(content.x, y, content.width, 1),
        );
    };

    match state.auth_ui_state() {
        AuthUiState::Checking => {
            centered(
                Line::from(vec![
                    Span::styled(
                        super::motion::spinner(state.animation_frame),
                        Style::default().fg(accent()),
                    ),
                    Span::styled(
                        " Checking sign-in status...",
                        Style::default().fg(text_muted()),
                    ),
                ]),
                auth_y,
            );
        }
        AuthUiState::SignedOut => {
            centered(
                Line::styled(
                    "Sign in to TaskForceAI to start working",
                    Style::default().fg(text()).add_modifier(Modifier::BOLD),
                ),
                auth_y,
            );
            if let Some(error) = state.login_error.as_deref() {
                centered(
                    Line::styled(error.to_string(), Style::default().fg(danger())),
                    auth_y.saturating_add(2),
                );
            }
            centered(
                Line::from(vec![
                    Span::styled(
                        "Enter",
                        Style::default().fg(action()).add_modifier(Modifier::BOLD),
                    ),
                    Span::styled(" sign in", Style::default().fg(text_faint())),
                ]),
                auth_y.saturating_add(4),
            );
        }
        AuthUiState::Starting => {
            centered(
                Line::from(vec![
                    Span::styled(
                        super::motion::spinner(state.animation_frame),
                        Style::default().fg(accent()),
                    ),
                    Span::styled(" Starting secure sign in...", Style::default().fg(text())),
                ]),
                auth_y,
            );
            centered(
                Line::styled("Esc cancel", Style::default().fg(text_faint())),
                auth_y.saturating_add(3),
            );
        }
        AuthUiState::WaitingForBrowser => {
            // coverage:ignore-start -- WaitingForBrowser is derived from pending_login being Some.
            let Some(login) = state.pending_login.as_ref() else {
                return;
            };
            // coverage:ignore-end
            centered(
                Line::from(vec![
                    Span::styled(
                        super::motion::spinner(state.animation_frame),
                        Style::default().fg(accent()),
                    ),
                    Span::styled(
                        " Waiting for browser approval...",
                        Style::default().fg(text()),
                    ),
                ]),
                auth_y,
            );
            centered(
                Line::styled(
                    login.verification_uri.clone(),
                    Style::default()
                        .fg(action())
                        .add_modifier(Modifier::UNDERLINED),
                ),
                auth_y.saturating_add(2),
            );
            centered(
                Line::from(vec![
                    Span::styled("Code  ", Style::default().fg(text_faint())),
                    Span::styled(
                        login.user_code.clone(),
                        Style::default().fg(text()).add_modifier(Modifier::BOLD),
                    ),
                ]),
                auth_y.saturating_add(3),
            );
            if let Some(error) = state.login_error.as_deref() {
                centered(
                    Line::styled(error.to_string(), Style::default().fg(danger())),
                    auth_y.saturating_add(4),
                );
            }
            centered(
                Line::from(vec![
                    Span::styled("Enter", Style::default().fg(action())),
                    Span::styled(" reopen browser  ·  ", Style::default().fg(text_faint())),
                    Span::styled("c", Style::default().fg(action())),
                    Span::styled(" copy code  ·  ", Style::default().fg(text_faint())),
                    Span::styled("Esc", Style::default().fg(action())),
                    Span::styled(" cancel", Style::default().fg(text_faint())),
                ]),
                auth_y.saturating_add(6),
            );
        }
        AuthUiState::SignedIn => {}
    }
}

pub(crate) fn auth_url_at(area: Rect, column: u16, row: u16, state: &AppState) -> Option<String> {
    if state.auth_ui_state() != AuthUiState::WaitingForBrowser {
        return None;
    }
    let content = launch_content_area(area);
    let url_y = content.y.saturating_add(7);
    if row == url_y && column >= content.x && column < content.x.saturating_add(content.width) {
        return state
            .pending_login
            .as_ref()
            .map(|login| login.verification_uri_complete.clone());
    }
    None
}

fn launch_content_area(area: Rect) -> Rect {
    let width = area.width.saturating_sub(4).min(92);
    let height = area.height.min(13);
    Rect::new(
        area.x.saturating_add(area.width.saturating_sub(width) / 2),
        area.y
            .saturating_add(area.height.saturating_sub(height) / 2),
        width,
        height,
    )
}

#[cfg(test)]
mod tests {
    use ratatui::backend::TestBackend;
    use ratatui::Terminal;

    use super::*;
    use crate::test_support::initialized_default_capabilities;

    #[test]
    fn launch_is_centered_and_model_first() {
        let mut state = AppState::new(initialized_default_capabilities(), Vec::new());
        state.set_authenticated(true);
        state.current_model_id = "openai/gpt-5.6-sol".to_string();
        state.status_line = "Sync pulled 12 conversations and 20 messages".to_string();
        let backend = TestBackend::new(120, 30);
        let mut terminal = Terminal::new(backend).expect("terminal");

        terminal
            .draw(|frame| render_launch(frame, frame.area(), &state))
            .expect("launch should render");

        let rendered = terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(|cell| cell.symbol())
            .collect::<String>();
        assert!(rendered.contains("TaskForceAI"));
        assert!(rendered.contains("openai/gpt-5.6-sol"));
        assert!(rendered.contains("effort medium"));
        assert!(rendered.contains("single-agent"));
        assert!(rendered.contains("/resume"));
        assert!(!rendered.contains("Sync pulled"));
        assert!(launch_content_area(Rect::new(0, 0, 120, 30)).x > 0);
    }

    #[test]
    fn launch_falls_back_to_the_composer_in_tiny_terminals() {
        let mut state = AppState::new(initialized_default_capabilities(), Vec::new());
        state.set_authenticated(true);
        let backend = TestBackend::new(18, 6);
        let mut terminal = Terminal::new(backend).expect("terminal");

        terminal
            .draw(|frame| render_launch(frame, frame.area(), &state))
            .expect("tiny launch should render");
    }

    #[test]
    fn signed_out_launch_is_a_dedicated_auth_state() {
        let mut state = AppState::new(initialized_default_capabilities(), Vec::new());
        state.set_authenticated(false);
        let backend = TestBackend::new(120, 30);
        let mut terminal = Terminal::new(backend).expect("terminal");

        terminal
            .draw(|frame| render_launch(frame, frame.area(), &state))
            .expect("launch should render");

        let rendered = terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(|cell| cell.symbol())
            .collect::<String>();
        assert!(rendered.contains("Sign in to TaskForceAI"));
        assert!(!rendered.contains("/resume"));
    }

    #[test]
    fn launch_auth_renders_checking_starting_waiting_errors_and_hit_testing() {
        let backend = TestBackend::new(120, 30);
        let mut terminal = Terminal::new(backend).expect("terminal");
        let mut state = AppState::new(initialized_default_capabilities(), Vec::new());

        state.auth_checked = false;
        terminal
            .draw(|frame| render_launch(frame, frame.area(), &state))
            .expect("checking");

        state.auth_checked = true;
        state.authenticated = false;
        state.login_error = Some("Try again".to_string());
        terminal
            .draw(|frame| render_launch(frame, frame.area(), &state))
            .expect("signed out error");

        let attempt = state.begin_login_attempt();
        terminal
            .draw(|frame| render_launch(frame, frame.area(), &state))
            .expect("starting");
        state.apply_login_started(
            attempt,
            taskforceai_app_protocol::DeviceLoginStartResult {
                device_code: "device".to_string(),
                user_code: "ABCD".to_string(),
                verification_uri: "https://example.test/device".to_string(),
                verification_uri_complete: "https://example.test/device?code=ABCD".to_string(),
                expires_in: 60,
                interval: 1,
            },
        );
        state.login_error = Some("Still waiting".to_string());
        terminal
            .draw(|frame| render_launch(frame, frame.area(), &state))
            .expect("waiting");

        let area = Rect::new(0, 0, 120, 30);
        let content = launch_content_area(area);
        let url_y = content.y + 7;
        assert!(auth_url_at(area, content.x, url_y, &state).is_some());
        assert!(auth_url_at(area, content.x, url_y + 1, &state).is_none());
        assert!(auth_url_at(area, content.x + content.width, url_y, &state).is_none());

        state.set_authenticated(true);
        assert!(auth_url_at(area, content.x, url_y, &state).is_none());
        terminal
            .draw(|frame| render_launch_auth(frame, content, url_y, &state))
            .expect("signed in no-op");
    }
}
