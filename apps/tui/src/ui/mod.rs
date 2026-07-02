use ratatui::style::Style;
use ratatui::widgets::Block;
use ratatui::Frame;

use crate::state::AppState;

mod composer;
mod footer;
mod header;
mod layout;
mod runs;
mod style;

pub use footer::{footer_action_at, FooterAction};
pub use layout::{run_index_at, run_scroll_offset};

use self::composer::render_composer;
use self::footer::render_footer;
use self::header::render_header;
use self::layout::root_chunks;
use self::runs::render_runs;
use self::style::BG;

pub fn render(frame: &mut Frame<'_>, state: &AppState) {
    let area = frame.area();
    frame.render_widget(Block::default().style(Style::default().bg(BG)), area);
    let chunks = root_chunks(area);

    render_header(frame, chunks[0], state);
    render_runs(frame, chunks[1], state);
    render_composer(frame, chunks[2], state);
    render_footer(frame, chunks[3], state);
}

#[cfg(test)]
mod tests {
    use ratatui::backend::TestBackend;
    use ratatui::layout::Rect;
    use ratatui::Terminal;
    use serde_json::json;
    use taskforceai_app_protocol::{
        Capabilities, InitializeResult, ModelOptionRecord, RunRecord, RunStatus, ServerInfo,
        TransportInfo,
    };

    use super::composer::{command_suggestion_spans, prompt_cursor_position};
    use super::header::compact_model_id;
    use super::runs::{
        command_palette_scroll, format_records, model_selector_lines, model_selector_scroll,
        run_detail_lines,
    };
    use super::*;
    use crate::state::{FocusArea, UiAction};

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
                voice: true,
            },
        }
    }

    fn run() -> RunRecord {
        RunRecord {
            id: "r1".to_string(),
            status: RunStatus::Processing,
            prompt: "investigate".to_string(),
            output: None,
            error: None,
            created_at: 1,
            updated_at: 2,
            model_id: None,
            project_id: None,
            tool_events: vec![json!({"toolName":"search","status":"completed"})],
            sources: vec![json!({"title":"Docs","url":"https://example.test/docs"})],
            agent_statuses: vec![json!({"agentName":"Research","status":"working"})],
            pending_approval: Some(json!({"permission":"mcp","agentName":"Research"})),
        }
    }

    #[test]
    fn render_draws_full_tui_surface() {
        let backend = TestBackend::new(120, 30);
        let mut terminal = Terminal::new(backend).expect("terminal");
        let state = AppState::new(initialized(), vec![run()]);

        terminal
            .draw(|frame| render(frame, &state))
            .expect("full TUI render should succeed");
    }

    fn line_text(line: ratatui::text::Line<'_>) -> String {
        line.spans
            .into_iter()
            .map(|span| span.content.into_owned())
            .collect::<String>()
    }

    #[test]
    fn detail_lines_include_stream_metadata() {
        let lines = run_detail_lines(&run())
            .into_iter()
            .map(line_text)
            .collect::<Vec<_>>();

        assert!(lines.iter().any(|line| line == "Sources Docs"));
        assert!(lines.iter().any(|line| line == "Tools search"));
        assert!(lines.iter().any(|line| line == "Agents Research"));
        assert!(lines.iter().any(|line| line == "Approval Research"));
    }

    #[test]
    fn detail_lines_compact_generated_media_and_show_errors() {
        let mut run = run();
        run.status = RunStatus::Failed;
        run.output = Some(
            "<video controls><source src=\"https://example.test/generated.mp4\"></video>"
                .to_string(),
        );
        run.error = Some("render failed".to_string());

        let lines = run_detail_lines(&run)
            .into_iter()
            .map(line_text)
            .collect::<Vec<_>>();

        assert!(lines.iter().any(|line| line == "Run r1 failed"));
        assert!(lines
            .iter()
            .any(|line| line == "Generated video: https://example.test/generated.mp4"));
        assert!(lines.iter().any(|line| line == "Error render failed"));
    }

    #[test]
    fn detail_lines_show_waiting_message_before_output_exists() {
        let lines = run_detail_lines(&run())
            .into_iter()
            .map(line_text)
            .collect::<Vec<_>>();

        assert!(lines.iter().any(|line| line == "Waiting for output"));
    }

    #[test]
    fn record_format_prefers_readable_fields() {
        assert_eq!(
            format_records(&[
                json!({"url":"https://example.test"}),
                json!({"status":"queued"})
            ]),
            "https://example.test, queued"
        );
    }

    #[test]
    fn record_format_falls_back_to_strings_and_json() {
        assert_eq!(
            format_records(&[
                json!("plain"),
                json!({"count":2}),
                json!(["nested", "value"])
            ]),
            "plain, {\"count\":2}, [\"nested\",\"value\"]"
        );
    }

    #[test]
    fn run_hit_test_maps_clicks_to_visible_run_rows() {
        let area = Rect {
            x: 0,
            y: 0,
            width: 100,
            height: 30,
        };

        assert_eq!(run_index_at(area, 2, 5, 3, 0), Some(0));
        assert_eq!(run_index_at(area, 2, 6, 3, 0), Some(1));
        assert_eq!(run_index_at(area, 2, 5, 0, 0), None);
        assert_eq!(run_index_at(area, 2, 9, 3, 0), None);
        assert_eq!(run_index_at(area, 60, 6, 3, 0), None);
        assert_eq!(run_index_at(area, 2, 5, 20, 12), Some(12));
    }

    #[test]
    fn footer_hit_test_maps_clicks_to_actions() {
        let area = Rect {
            x: 0,
            y: 0,
            width: 120,
            height: 30,
        };

        assert_eq!(footer_action_at(area, 1, 28), Some(FooterAction::Submit));
        assert_eq!(footer_action_at(area, 16, 28), Some(FooterAction::Cancel));
        assert_eq!(footer_action_at(area, 32, 28), Some(FooterAction::Delete));
        assert_eq!(footer_action_at(area, 101, 28), Some(FooterAction::Quit));
        assert_eq!(footer_action_at(area, 49, 28), None);
        assert_eq!(footer_action_at(area, 90, 28), None);
        assert_eq!(footer_action_at(area, 60, 28), None);
    }

    #[test]
    fn run_scroll_keeps_selected_run_visible() {
        let area = Rect {
            x: 0,
            y: 0,
            width: 100,
            height: 20,
        };
        let runs = (0..20)
            .map(|index| RunRecord {
                id: format!("r{index}"),
                status: RunStatus::Processing,
                prompt: "investigate".to_string(),
                output: None,
                error: None,
                created_at: 1,
                updated_at: 2,
                model_id: None,
                project_id: None,
                tool_events: Vec::new(),
                sources: Vec::new(),
                agent_statuses: Vec::new(),
                pending_approval: None,
            })
            .collect::<Vec<_>>();
        let mut state = crate::state::AppState::new(initialized(), runs);
        state.selected_run_id = Some("r12".to_string());

        let offset = run_scroll_offset(area, &state);

        assert_eq!(offset, 5);
        assert_eq!(run_index_at(area, 2, 5, state.runs.len(), offset), Some(5));
        assert_eq!(
            run_scroll_offset(
                Rect {
                    x: 0,
                    y: 0,
                    width: 100,
                    height: 0,
                },
                &state,
            ),
            0
        );
    }

    #[test]
    #[ignore = "performance baseline: run explicitly with --ignored --nocapture"]
    fn perf_select_and_scroll_large_run_history() {
        const RUN_COUNT: usize = 10_000;
        const ITERATIONS: usize = 5_000;
        let area = Rect {
            x: 0,
            y: 0,
            width: 120,
            height: 32,
        };
        let runs = (0..RUN_COUNT)
            .map(|index| RunRecord {
                id: format!("r{index}"),
                status: RunStatus::Processing,
                prompt: "investigate".to_string(),
                output: None,
                error: None,
                created_at: 1,
                updated_at: 2,
                model_id: None,
                project_id: None,
                tool_events: Vec::new(),
                sources: Vec::new(),
                agent_statuses: Vec::new(),
                pending_approval: None,
            })
            .collect::<Vec<_>>();
        let mut state = crate::state::AppState::new(initialized(), runs);
        state.apply(UiAction::SelectRunAtIndex(RUN_COUNT - 2));

        let started = std::time::Instant::now();
        let mut observed = 0_usize;
        for _ in 0..ITERATIONS {
            state.apply(UiAction::SelectNextRun);
            observed = observed.saturating_add(run_scroll_offset(area, &state));
            state.apply(UiAction::SelectPreviousRun);
            observed = observed.saturating_add(run_scroll_offset(area, &state));
        }
        std::hint::black_box(observed);
        let elapsed = started.elapsed();
        let operations = ITERATIONS * 4;
        let avg_nanos = elapsed.as_nanos() / operations as u128;
        eprintln!(
            "perf_select_and_scroll_large_run_history: operations={operations} total_ms={:.3} avg_ns={avg_nanos}",
            elapsed.as_secs_f64() * 1_000.0
        );
    }

    #[test]
    fn prompt_cursor_tracks_prompt_input_when_focused() {
        let mut state = crate::state::AppState::new(initialized(), Vec::new());
        state.prompt_input = "hello".to_string();
        let area = Rect {
            x: 4,
            y: 10,
            width: 30,
            height: 3,
        };

        assert_eq!(prompt_cursor_position(area, &state), Some((12, 11)));

        state.focus = FocusArea::Runs;
        assert_eq!(prompt_cursor_position(area, &state), None);
    }

    #[test]
    fn compact_model_id_preserves_short_values_and_truncates_long_values() {
        assert_eq!(compact_model_id("openai/gpt-5.5"), "openai/gpt-5.5");
        assert_eq!(
            compact_model_id("google/gemini-3.1-pro-preview"),
            "google/gemini-3.1-pro-pre..."
        );
        assert_eq!(compact_model_id("   "), "default");
    }

    #[test]
    fn command_suggestion_spans_keep_selected_option_visible_within_width() {
        let mut state = crate::state::AppState::new(initialized(), Vec::new());
        state.command_suggestions = vec!["/login", "/logout", "/upgrade", "/update", "/status"];
        state.selected_command_suggestion = Some(4);

        let text = command_suggestion_spans(&state, 22)
            .into_iter()
            .map(|span| span.content.into_owned())
            .collect::<String>();

        assert!(text.contains("/status"));
        assert!(text.starts_with("< "));
        assert!(text.chars().count() <= 22);
    }

    #[test]
    #[ignore = "performance baseline: run explicitly with --ignored --nocapture"]
    fn perf_command_suggestion_spans() {
        const ITERATIONS: usize = 200_000;
        let mut state = crate::state::AppState::new(initialized(), Vec::new());
        state.command_suggestions = vec![
            "/login",
            "/logout",
            "/upgrade",
            "/update",
            "/status",
            "/inspect",
            "/doctor",
            "/sync",
            "/settings",
            "/model",
            "/ollama",
            "/hybrid",
            "/code",
            "/search",
            "/usage",
            "/account",
            "/artifacts",
            "/mcp",
            "/mock",
            "/attach",
        ];
        state.selected_command_suggestion = Some(8);

        let started = std::time::Instant::now();
        let mut rendered = 0_usize;
        for selected in 0..20 {
            state.selected_command_suggestion = Some(selected);
            for _ in 0..(ITERATIONS / 20) {
                std::hint::black_box(command_suggestion_spans(&state, 72));
                rendered += 1;
            }
        }
        let elapsed = started.elapsed();
        let avg_nanos = elapsed.as_nanos() / rendered as u128;
        eprintln!(
            "perf_command_suggestion_spans: rendered={rendered} total_ms={:.3} avg_ns={avg_nanos}",
            elapsed.as_secs_f64() * 1_000.0
        );
    }

    #[test]
    fn command_palette_scroll_tracks_selected_option() {
        let mut state = crate::state::AppState::new(initialized(), Vec::new());
        state.prompt_input = "/".to_string();
        state.command_suggestions = vec![
            "/login",
            "/logout",
            "/upgrade",
            "/update",
            "/status",
            "/inspect",
            "/doctor",
            "/sync",
            "/settings",
            "/model",
            "/ollama",
            "/hybrid",
            "/code",
            "/search",
            "/usage",
            "/account",
            "/artifacts",
            "/mcp",
            "/mock",
            "/attach",
        ];
        state.selected_command_suggestion = Some(15);
        let area = Rect {
            x: 0,
            y: 0,
            width: 40,
            height: 8,
        };

        assert_eq!(command_palette_scroll(area, &state), 12);

        state.selected_command_suggestion = Some(1);
        assert_eq!(command_palette_scroll(area, &state), 0);
        assert_eq!(
            command_palette_scroll(
                Rect {
                    x: 0,
                    y: 0,
                    width: 40,
                    height: 0,
                },
                &state,
            ),
            0
        );
    }

    #[test]
    fn model_selector_scroll_counts_description_lines() {
        let mut state = crate::state::AppState::new(initialized(), Vec::new());
        state.model_selector = Some(crate::state::ModelSelectorState {
            options: (0..10)
                .map(|index| ModelOptionRecord {
                    id: format!("model-{index}"),
                    label: format!("Model {index}"),
                    badge: "fast".to_string(),
                    description: Some("description".to_string()),
                    usage_multiple: None,
                })
                .collect(),
            default_model_id: "model-0".to_string(),
            selected_model_id: Some("model-0".to_string()),
            selected_index: 6,
            remote_catalog: false,
        });
        let area = Rect {
            x: 0,
            y: 0,
            width: 40,
            height: 8,
        };

        assert_eq!(model_selector_scroll(area, &state), 10);
        assert_eq!(
            model_selector_scroll(
                Rect {
                    x: 0,
                    y: 0,
                    width: 40,
                    height: 0,
                },
                &state,
            ),
            0
        );
        state.model_selector = None;
        assert_eq!(model_selector_lines(&state).len(), 1);

        state.model_selector = Some(crate::state::ModelSelectorState {
            options: vec![
                ModelOptionRecord {
                    id: "model-0".to_string(),
                    label: "Model 0".to_string(),
                    badge: "fast".to_string(),
                    description: None,
                    usage_multiple: None,
                },
                ModelOptionRecord {
                    id: "model-1".to_string(),
                    label: "Model 1".to_string(),
                    badge: "deep".to_string(),
                    description: None,
                    usage_multiple: None,
                },
                ModelOptionRecord {
                    id: "model-2".to_string(),
                    label: "Model 2".to_string(),
                    badge: "balanced".to_string(),
                    description: None,
                    usage_multiple: None,
                },
            ],
            default_model_id: "model-1".to_string(),
            selected_model_id: Some("model-1".to_string()),
            selected_index: 0,
            remote_catalog: false,
        });
        assert!(!model_selector_lines(&state).is_empty());

        if let Some(selector) = &mut state.model_selector {
            selector.selected_model_id = Some("model-0".to_string());
        }
        assert!(!model_selector_lines(&state).is_empty());
    }

    #[test]
    #[ignore = "performance baseline: run explicitly with --ignored --nocapture"]
    fn perf_model_selector_lines() {
        const MODEL_COUNT: usize = 120;
        const ITERATIONS: usize = 50_000;
        let mut state = crate::state::AppState::new(initialized(), Vec::new());
        state.model_selector = Some(crate::state::ModelSelectorState {
            options: (0..MODEL_COUNT)
                .map(|index| ModelOptionRecord {
                    id: format!("provider/model-{index:03}-long-context"),
                    label: format!("Model {index}"),
                    badge: if index % 2 == 0 {
                        "fast".to_string()
                    } else {
                        "deep".to_string()
                    },
                    description: Some(format!(
                        "handles agentic workflow batch {index} with extended memory"
                    )),
                    usage_multiple: (index % 3 == 0).then_some(1.25 + index as f64 / 100.0),
                })
                .collect(),
            default_model_id: "provider/model-000-long-context".to_string(),
            selected_model_id: Some("provider/model-006-long-context".to_string()),
            selected_index: 6,
            remote_catalog: true,
        });

        let started = std::time::Instant::now();
        let mut rendered = 0_usize;
        for selected in 0..MODEL_COUNT {
            if let Some(selector) = &mut state.model_selector {
                selector.selected_index = selected;
            }
            for _ in 0..(ITERATIONS / MODEL_COUNT) {
                std::hint::black_box(model_selector_lines(&state));
                rendered += 1;
            }
        }
        let elapsed = started.elapsed();
        let avg_nanos = elapsed.as_nanos() / rendered as u128;
        eprintln!(
            "perf_model_selector_lines: rendered={rendered} total_ms={:.3} avg_ns={avg_nanos}",
            elapsed.as_secs_f64() * 1_000.0
        );
    }
}
