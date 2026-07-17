use std::hint::black_box;
use std::time::Instant;

use ratatui::backend::TestBackend;
use ratatui::layout::Rect;
use ratatui::text::Line;
use ratatui::Terminal;
use serde_json::json;
use taskforceai_app_protocol::{
    ModelListResult, ModelOptionRecord, RunRecord, RunStatus, TaskMode, ThreadItemRecord,
    ThreadItemStatus, ThreadItemType, ThreadRecord, ThreadState, TurnRecord, TurnStatus,
};

use super::{
    collect_markdown_links, collect_value_links, command_output_lines, conversation_snippet,
    conversation_title, file_suggestion_lines, file_suggestion_scroll, format_sources,
    is_openable_url, navigable_thread_detail_lines, optimistic_submission_lines, preview,
    render_runs, run_detail_lines, run_item, run_item_line, semantic_links, status_bullet,
    status_label, status_style, thread_detail_lines, thread_detail_lines_with_tool_details,
    thread_item_lines, todo_lines, url_at, url_at_column, SemanticLink,
};
use crate::state::{AppState, TodoItem, UiAction};
use crate::test_support::initialized_default_capabilities;

#[test]
fn status_helpers_cover_all_run_states() {
    let cases = [
        (RunStatus::Queued, "queued", "[~]"),
        (RunStatus::Processing, "processing", "[>]"),
        (RunStatus::Completed, "completed", "[+]"),
        (RunStatus::Failed, "failed", "[!]"),
        (RunStatus::Canceled, "canceled", "[-]"),
    ];

    for (status, label, bullet) in cases {
        assert_eq!(status_label(&status), label);
        assert_eq!(status_bullet(&status), bullet);
        let _style = status_style(&status);
    }
}

#[test]
fn run_item_covers_unselected_rows_and_output_preview() {
    let statuses = [
        RunStatus::Queued,
        RunStatus::Processing,
        RunStatus::Completed,
        RunStatus::Failed,
        RunStatus::Canceled,
    ];

    for (index, status) in statuses.into_iter().enumerate() {
        let mut run = bench_run(index);
        run.status = status;
        run.output = Some("visible output".to_string());
        let _item = run_item(&run, false, 0);
    }
}

#[test]
fn run_item_line_uses_conversation_preview_without_run_id() {
    let mut run = bench_run(42);
    run.id = "local_run_42".to_string();
    run.prompt = "Plan the mobile sidebar parity work".to_string();
    run.output = Some("Use compact conversation previews".to_string());

    let rendered = line_text(run_item_line(&run, true, 0));

    assert!(rendered.contains("Plan the mobile sidebar parity work"));
    assert!(rendered.contains("Use compact conversation previews"));
    assert!(!rendered.contains("local_run_42"));
}

#[test]
fn conversation_preview_covers_empty_title_error_and_echo_output() {
    let mut untitled = bench_run(1);
    untitled.prompt = "   ".to_string();
    assert_eq!(conversation_title(&untitled), "Untitled conversation");

    let mut error_run = bench_run(2);
    error_run.output = None;
    error_run.error = Some(" backend unavailable ".to_string());
    assert_eq!(
        conversation_snippet(&error_run, 40).as_deref(),
        Some("Error: backend unavailable")
    );

    let mut empty_error_run = bench_run(4);
    empty_error_run.output = None;
    empty_error_run.error = Some("   ".to_string());
    assert_eq!(conversation_snippet(&empty_error_run, 40), None);

    let mut echoed_run = bench_run(3);
    echoed_run.prompt = "repeat this".to_string();
    echoed_run.output = Some(" repeat this ".to_string());
    echoed_run.error = None;
    assert_eq!(conversation_snippet(&echoed_run, 40), None);
}

#[test]
fn preview_truncates_on_character_boundaries() {
    assert_eq!(preview("short", 10), "short");
    assert_eq!(preview("abcdef", 3), "abc...");
    assert_eq!(preview("áβçd", 3), "áβç...");
}

#[test]
fn semantic_link_labels_and_file_urls_are_clickable() {
    let links = vec![SemanticLink {
        label: "runbook".to_string(),
        url: "https://example.test/runbook".to_string(),
    }];

    assert_eq!(
        url_at_column("Open runbook now", 7, &links).as_deref(),
        Some("https://example.test/runbook")
    );
    assert_eq!(
        url_at_column("file:///tmp/report.txt", 3, &[]).as_deref(),
        Some("file:///tmp/report.txt")
    );
}

#[test]
fn diff_command_output_uses_structured_diff_styles() {
    let lines = command_output_lines("Diff\n@@ -1 +1 @@\n-old\n+new");
    let removed = lines
        .iter()
        .find(|line| line_text((*line).clone()).contains("-old"))
        .expect("removed line");
    let added = lines
        .iter()
        .find(|line| line_text((*line).clone()).contains("+new"))
        .expect("added line");

    let removed_style = removed
        .spans
        .iter()
        .find(|span| span.content.contains("-old"))
        .expect("removed content")
        .style;
    let added_style = added
        .spans
        .iter()
        .find(|span| span.content.contains("+new"))
        .expect("added content")
        .style;
    assert_ne!(removed_style.fg, added_style.fg);
}

fn line_text(line: Line<'_>) -> String {
    line.spans
        .into_iter()
        .map(|span| span.content.into_owned())
        .collect::<String>()
}

fn bench_run(index: usize) -> RunRecord {
    RunRecord {
        id: format!("run-{index:04}-abcdefghijklmnopqrstuvwxyz"),
        prompt: format!("Investigate customer workflow regression number {index}"),
        model_id: None,
        project_id: None,
        status: RunStatus::Processing,
        output: Some(format!(
            "Detailed response for run {index} with enough text to require preview truncation"
        )),
        error: None,
        created_at: 1_720_000_000,
        updated_at: 1_720_000_100,
        tool_events: vec![json!({"toolName":"search","status":"completed"})],
        sources: vec![json!({"title":"Runbook","url":"https://example.test/runbook"})],
        agent_statuses: vec![json!({"agentName":"Research","status":"working"})],
        pending_approval: Some(json!({"permission":"mcp","agentName":"Research"})),
    }
}

fn model_list() -> ModelListResult {
    ModelListResult {
        enabled: true,
        options: vec![
            ModelOptionRecord {
                id: "sentinel".to_string(),
                label: "Sentinel".to_string(),
                badge: "default".to_string(),
                description: Some("Default model".to_string()),
                usage_multiple: Some(1.0),
                reasoning_effort_levels: Vec::new(),
                default_reasoning_effort: None,
            },
            ModelOptionRecord {
                id: "gpt-5".to_string(),
                label: "GPT-5".to_string(),
                badge: "deep".to_string(),
                description: Some("".to_string()),
                usage_multiple: Some(2.25),
                reasoning_effort_levels: Vec::new(),
                default_reasoning_effort: None,
            },
        ],
        default_model_id: "sentinel".to_string(),
        selected_model_id: Some("sentinel".to_string()),
        remote_catalog: true,
    }
}

#[test]
fn render_runs_draws_empty_details_commands_and_model_selector() {
    let area = Rect::new(0, 0, 120, 20);
    let backend = TestBackend::new(120, 20);
    let mut terminal = Terminal::new(backend).expect("terminal");

    let empty = AppState::new(initialized_default_capabilities(), Vec::new());
    terminal
        .draw(|frame| render_runs(frame, area, &empty))
        .expect("empty runs should render");
    let mut expanded_empty = empty.clone();
    expanded_empty.apply(UiAction::ToggleSidebar);
    terminal
        .draw(|frame| render_runs(frame, area, &expanded_empty))
        .expect("expanded empty conversations should render");

    let selected = AppState::new(
        initialized_default_capabilities(),
        vec![bench_run(1), bench_run(2)],
    );
    terminal
        .draw(|frame| render_runs(frame, area, &selected))
        .expect("selected run should render");

    let mut expanded = selected.clone();
    expanded.apply(UiAction::ToggleSidebar);
    terminal
        .draw(|frame| render_runs(frame, area, &expanded))
        .expect("expanded sidebar should render");

    let mut command_output = selected.clone();
    command_output.apply(UiAction::CommandOutputDisplayed {
        title: "Status".to_string(),
        message: "Ready".to_string(),
    });
    terminal
        .draw(|frame| render_runs(frame, area, &command_output))
        .expect("command output should render");

    let mut commands = selected.clone();
    commands.apply(UiAction::AppendPrompt('/'));
    terminal
        .draw(|frame| render_runs(frame, area, &commands))
        .expect("command palette should render");

    let mut pending = AppState::new(initialized_default_capabilities(), Vec::new());
    pending.task_mode = crate::state::TaskMode::Work;
    pending.begin_prompt_submission("Pending without thread".to_string());
    terminal
        .draw(|frame| render_runs(frame, area, &pending))
        .expect("optimistic submission should render");

    let mut models = selected;
    models.apply(UiAction::ModelSelectorOpened(model_list()));
    models.apply(UiAction::SelectNextModel);
    terminal
        .draw(|frame| render_runs(frame, area, &models))
        .expect("model selector should render");
}

#[test]
fn render_runs_draws_files_and_complete_thread_activity() {
    let area = Rect::new(0, 0, 120, 30);
    let backend = TestBackend::new(120, 30);
    let mut terminal = Terminal::new(backend).expect("terminal");
    let mut files = AppState::new(initialized_default_capabilities(), vec![bench_run(1)]);
    files.prompt_input = "review @src".into();
    files.prompt_cursor = files.prompt_input.len();
    files.set_file_suggestions(vec!["src/main.rs".into(), "src/lib.rs".into()]);
    files.select_file_suggestion(1);
    terminal
        .draw(|frame| render_runs(frame, area, &files))
        .expect("file suggestions should render");

    let item_types = [
        ThreadItemType::UserMessage,
        ThreadItemType::AgentMessage,
        ThreadItemType::Reasoning,
        ThreadItemType::ToolCall,
        ThreadItemType::Approval,
        ThreadItemType::Source,
        ThreadItemType::AgentStatus,
        ThreadItemType::Error,
        ThreadItemType::SteeringMessage,
    ];
    let statuses = [
        ThreadItemStatus::InProgress,
        ThreadItemStatus::Completed,
        ThreadItemStatus::Failed,
        ThreadItemStatus::Declined,
    ];
    let turn_statuses = [
        TurnStatus::Completed,
        TurnStatus::Failed,
        TurnStatus::Interrupted,
        TurnStatus::Queued,
        TurnStatus::InProgress,
    ];
    let turns = turn_statuses
        .into_iter()
        .enumerate()
        .map(|(turn_index, status)| TurnRecord {
            id: format!("turn-{turn_index}"),
            thread_id: "thread".into(),
            run_id: String::new(),
            status,
            items: item_types
                .iter()
                .enumerate()
                .map(|(index, item_type)| ThreadItemRecord {
                    id: format!("item-{turn_index}-{index}"),
                    turn_id: format!("turn-{turn_index}"),
                    item_type: *item_type,
                    status: statuses[index % statuses.len()],
                    content: match index % 3 {
                        0 => json!("plain text"),
                        1 => json!({"message":"structured text"}),
                        _ => json!({"nested":{"value":index}}),
                    },
                    created_at: index as u64,
                    updated_at: index as u64,
                })
                .collect(),
            created_at: turn_index as u64,
            updated_at: turn_index as u64,
        })
        .collect();
    let mut thread_state = AppState::new(initialized_default_capabilities(), vec![bench_run(1)]);
    thread_state.set_active_thread(ThreadRecord {
        id: "thread".into(),
        title: "Ship release".into(),
        objective: "Verify every surface".into(),
        state: ThreadState::Active,
        archived: false,
        source: "test".into(),
        task_mode: TaskMode::Code,
        parent_thread_id: None,
        turns,
        created_at: 0,
        updated_at: 1,
    });
    thread_state.begin_prompt_submission("Optimistic follow-up".to_string());
    terminal
        .draw(|frame| render_runs(frame, area, &thread_state))
        .expect("thread activity should render");

    thread_state.set_active_thread(ThreadRecord {
        id: "empty-thread".into(),
        title: "Waiting".into(),
        objective: String::new(),
        state: ThreadState::Paused,
        archived: false,
        source: "test".into(),
        task_mode: TaskMode::Work,
        parent_thread_id: None,
        turns: Vec::new(),
        created_at: 0,
        updated_at: 0,
    });
    thread_state.todos = vec![crate::state::TodoItem {
        id: "todo".into(),
        content: "Render progress".into(),
        status: "in_progress".into(),
        priority: None,
    }];
    terminal
        .draw(|frame| render_runs(frame, area, &thread_state))
        .expect("empty thread should render");
}

#[test]
fn thread_detail_dispatches_code_without_changing_work_or_chat() {
    let mut thread = ThreadRecord {
        id: "thread".into(),
        title: "Mode boundary".into(),
        objective: "Keep presentation scoped".into(),
        state: ThreadState::Active,
        archived: false,
        source: "test".into(),
        task_mode: TaskMode::Code,
        parent_thread_id: None,
        turns: vec![TurnRecord {
            id: "turn".into(),
            thread_id: "thread".into(),
            run_id: "run".into(),
            status: TurnStatus::Completed,
            items: vec![ThreadItemRecord {
                id: "agent".into(),
                turn_id: "turn".into(),
                item_type: ThreadItemType::AgentMessage,
                status: ThreadItemStatus::Completed,
                content: json!({"text":"Finished the focused change."}),
                created_at: 1,
                updated_at: 2,
            }],
            created_at: 1,
            updated_at: 2,
        }],
        created_at: 1,
        updated_at: 2,
    };

    let code = thread_detail_lines(&thread)
        .into_iter()
        .map(line_text)
        .collect::<Vec<_>>();
    assert!(code
        .iter()
        .any(|line| line == "• Finished the focused change."));
    assert!(!code.iter().any(|line| line.starts_with("Turn ")));

    thread.turns[0].items.push(ThreadItemRecord {
        id: "reasoning".into(),
        turn_id: "turn".into(),
        item_type: ThreadItemType::Reasoning,
        status: ThreadItemStatus::Completed,
        content: json!({"text":"Reasoning trace"}),
        created_at: 2,
        updated_at: 2,
    });
    let hidden = thread_detail_lines_with_tool_details(&thread, false, false, 0)
        .into_iter()
        .map(line_text)
        .collect::<Vec<_>>();
    assert!(!hidden.iter().any(|line| line.contains("Reasoning trace")));

    for mode in [TaskMode::Work, TaskMode::Chat] {
        let mut generic_thread = thread.clone();
        generic_thread.task_mode = mode;
        let generic = thread_detail_lines(&generic_thread)
            .into_iter()
            .map(line_text)
            .collect::<Vec<_>>();
        assert!(generic.iter().any(|line| line == "✓ Turn completed"));
        assert!(generic.iter().any(|line| line == "TaskForceAI"));
        let hidden_generic =
            thread_detail_lines_with_tool_details(&generic_thread, false, false, 0)
                .into_iter()
                .map(line_text)
                .collect::<Vec<_>>();
        assert!(!hidden_generic
            .iter()
            .any(|line| line.contains("Reasoning trace")));
    }
}

#[test]
fn generic_thread_details_cover_every_turn_item_and_status() {
    let item_types = [
        ThreadItemType::UserMessage,
        ThreadItemType::AgentMessage,
        ThreadItemType::Reasoning,
        ThreadItemType::ToolCall,
        ThreadItemType::Approval,
        ThreadItemType::Source,
        ThreadItemType::AgentStatus,
        ThreadItemType::Error,
        ThreadItemType::SteeringMessage,
    ];
    let item_statuses = [
        ThreadItemStatus::InProgress,
        ThreadItemStatus::Completed,
        ThreadItemStatus::Failed,
        ThreadItemStatus::Declined,
    ];
    let turns = [
        TurnStatus::Completed,
        TurnStatus::Failed,
        TurnStatus::Interrupted,
        TurnStatus::Queued,
        TurnStatus::InProgress,
    ]
    .into_iter()
    .enumerate()
    .map(|(turn_index, status)| TurnRecord {
        id: format!("turn-{turn_index}"),
        thread_id: "generic".into(),
        run_id: String::new(),
        status,
        items: if turn_index == 0 {
            item_types
                .into_iter()
                .enumerate()
                .map(|(index, item_type)| ThreadItemRecord {
                    id: format!("item-{index}"),
                    turn_id: "turn-0".into(),
                    item_type,
                    status: item_statuses[index % item_statuses.len()],
                    content: match index {
                        0 => json!("plain text"),
                        1 => json!({"nested":{"value":index}}),
                        _ => json!({"message":format!("item {index}")}),
                    },
                    created_at: 1,
                    updated_at: 2,
                })
                .collect()
        } else {
            Vec::new()
        },
        created_at: 1,
        updated_at: 2,
    })
    .collect();
    let thread = ThreadRecord {
        id: "generic".into(),
        title: "Generic timeline".into(),
        objective: "Cover generic rendering".into(),
        state: ThreadState::Active,
        archived: false,
        source: "test".into(),
        task_mode: TaskMode::Work,
        parent_thread_id: None,
        turns,
        created_at: 1,
        updated_at: 2,
    };

    let rendered = thread_detail_lines(&thread)
        .into_iter()
        .map(line_text)
        .collect::<Vec<_>>();

    for expected in [
        "✓ Turn completed",
        "! Turn failed",
        "− Turn interrupted",
        "· Turn queued",
        "⠋ Turn inprogress",
        "You · running",
        "TaskForceAI",
        "Reasoning · failed",
        "Tool · declined",
        "Approval · running",
        "Source",
        "Agent · failed",
        "Error · declined",
        "Steer · running",
        "  plain text",
    ] {
        assert!(rendered.iter().any(|line| line == expected), "{expected}");
    }
    assert!(rendered.iter().any(|line| line.contains("nested")));
}

#[test]
fn detail_helpers_cover_progress_links_agent_threads_and_optimistic_modes() {
    let mut state = AppState::new(initialized_default_capabilities(), vec![bench_run(1)]);
    state.task_mode = crate::state::TaskMode::Work;
    state.todos = vec![
        TodoItem {
            id: "1".into(),
            content: "Done".into(),
            status: "completed".into(),
            priority: Some("high".into()),
        },
        TodoItem {
            id: "2".into(),
            content: "Doing".into(),
            status: "in_progress".into(),
            priority: None,
        },
        TodoItem {
            id: "3".into(),
            content: "Canceled".into(),
            status: "cancelled".into(),
            priority: Some(String::new()),
        },
        TodoItem {
            id: "4".into(),
            content: "Waiting".into(),
            status: "pending".into(),
            priority: None,
        },
    ];
    assert_eq!(todo_lines(&state).len(), 5);

    state.prompt_input = "@src".into();
    state.prompt_cursor = state.prompt_input.len();
    state.set_file_suggestions(vec!["src/main.rs".into(), "src/lib.rs".into()]);
    state.select_file_suggestion(1);
    assert_eq!(file_suggestion_lines(&state).len(), 3);
    assert!(file_suggestion_scroll(Rect::new(0, 0, 20, 2), &state) > 0);
    state.file_suggestions.clear();

    let item = |item_type, status, content| ThreadItemRecord {
        id: format!("{item_type:?}-{status:?}"),
        turn_id: "turn".into(),
        item_type,
        status,
        content,
        created_at: 1,
        updated_at: 2,
    };
    for item_type in [
        ThreadItemType::CommandExecution,
        ThreadItemType::FileChange,
        ThreadItemType::Plan,
        ThreadItemType::Compaction,
    ] {
        assert!(!thread_item_lines(&item(
            item_type,
            ThreadItemStatus::Completed,
            json!({"text":"detail"}),
        ))
        .is_empty());
    }

    let child = ThreadRecord {
        id: "child".into(),
        title: "Child".into(),
        objective: "[docs](https://example.test/docs)".into(),
        state: ThreadState::Active,
        archived: false,
        source: "test".into(),
        task_mode: TaskMode::Work,
        parent_thread_id: Some("root".into()),
        turns: vec![TurnRecord {
            id: "turn".into(),
            thread_id: "child".into(),
            run_id: "run".into(),
            status: TurnStatus::Completed,
            items: vec![item(
                ThreadItemType::AgentMessage,
                ThreadItemStatus::Completed,
                json!({"nested":["[runbook](file:///tmp/runbook)", {"url":"https://example.test/source","label":"source"}]}),
            )],
            created_at: 1,
            updated_at: 2,
        }],
        created_at: 1,
        updated_at: 2,
    };
    let root = ThreadRecord {
        id: "root".into(),
        parent_thread_id: None,
        ..child.clone()
    };
    let family = [root.clone(), child.clone()];
    let nav = navigable_thread_detail_lines(&child, &family, false, true, 0);
    assert!(nav
        .iter()
        .map(|line| line_text(line.clone()))
        .any(|line| line.contains("Agent thread")));

    state.set_active_thread(child);
    let links = semantic_links(&state);
    assert!(links.iter().any(|link| link.label == "docs"));
    assert!(links.iter().any(|link| link.label == "source"));

    let mut collected = Vec::new();
    collect_value_links(
        &json!(["[one](https://one.test)", {"url":"file:///tmp/two","title":"two"}, 3]),
        &mut collected,
    );
    collect_markdown_links(
        "[broken [ok](http://ok.test) [bad](ftp://bad)",
        &mut collected,
    );
    collect_markdown_links("[broken", &mut collected);
    collect_markdown_links("[label](https://missing-close", &mut collected);
    assert!(collected.iter().any(|link| link.label == "one"));
    assert!(is_openable_url("file:///tmp/file"));
    assert!(!is_openable_url("ftp://bad"));

    state.command_output = Some("Links\n[command](https://example.test/command)".into());
    assert!(semantic_links(&state)
        .iter()
        .any(|link| link.label == "command"));
    state.command_output = None;
    state.begin_prompt_submission("Sending now".into());
    let pending = state.pending_submission.as_ref().unwrap();
    assert!(!optimistic_submission_lines(pending, crate::state::TaskMode::Chat, 0).is_empty());
    assert!(!optimistic_submission_lines(pending, crate::state::TaskMode::Code, 0).is_empty());
    assert_eq!(
        format_sources(&[
            json!({"title":"Title only"}),
            json!({"url":"https://url-only.test"}),
            json!({"other":"fallback"}),
        ]),
        "Title only, https://url-only.test, {\"other\":\"fallback\"}"
    );
}

#[test]
fn url_hit_testing_covers_guards_bounds_raw_urls_and_exhaustion() {
    let links = vec![
        SemanticLink {
            label: "same".into(),
            url: "https://first.test".into(),
        },
        SemanticLink {
            label: "target".into(),
            url: "https://target.test".into(),
        },
    ];
    assert_eq!(
        url_at_column("same same target", 11, &links).as_deref(),
        Some("https://target.test")
    );
    assert_eq!(
        url_at_column("https://one.test, then http://two.test!", 30, &[]).as_deref(),
        Some("http://two.test")
    );
    assert!(url_at_column("no links", 2, &links).is_none());
    assert!(url_at_column("same", 99, &links).is_none());
    assert!(url_at_column("https://only.test", 99, &[]).is_none());

    let root = Rect::new(0, 0, 120, 30);
    let mut state = AppState::new(initialized_default_capabilities(), vec![bench_run(1)]);
    assert!(url_at(root, 0, 0, &state).is_none());
    state.apply(UiAction::ModelSelectorOpened(model_list()));
    assert!(url_at(root, 50, 5, &state).is_none());
    state.apply(UiAction::ModelSelectorClosed);
    state.command_output = Some("Open https://example.test/here".into());
    let mut found = None;
    for row in 5..20 {
        for column in 2..118 {
            if let Some(url) = url_at(root, column, row, &state) {
                found = Some(url);
                break;
            }
        }
        if found.is_some() {
            break;
        }
    }
    assert_eq!(found.as_deref(), Some("https://example.test/here"));

    state.command_output = None;
    state.todos = vec![TodoItem {
        id: "todo".into(),
        content: "See https://todo.test".into(),
        status: "pending".into(),
        priority: None,
    }];
    state.task_mode = crate::state::TaskMode::Work;
    let _ = url_at(root, 50, 5, &state);

    let mut thread_state = AppState::new(initialized_default_capabilities(), Vec::new());
    thread_state.set_active_thread(ThreadRecord {
        id: "thread".into(),
        title: "Thread".into(),
        objective: "https://thread.test".into(),
        state: ThreadState::Active,
        archived: false,
        source: "test".into(),
        task_mode: TaskMode::Work,
        parent_thread_id: None,
        turns: Vec::new(),
        created_at: 1,
        updated_at: 1,
    });
    let _ = url_at(root, 50, 5, &thread_state);
    assert!(url_at(root, 50, 17, &thread_state).is_none());

    let empty = AppState::new(initialized_default_capabilities(), Vec::new());
    assert!(url_at(root, 50, 5, &empty).is_none());
    assert!(url_at(root, 50, 19, &state).is_none());
}

#[test]
#[ignore = "performance baseline: run explicitly with --ignored --nocapture"]
fn perf_render_run_rows_and_detail_lines() {
    const RUN_COUNT: usize = 400;
    const ITERATIONS: usize = 2_000;
    let runs = (0..RUN_COUNT).map(bench_run).collect::<Vec<_>>();

    let started = Instant::now();
    let mut rendered = 0_usize;
    for iteration in 0..ITERATIONS {
        for (index, run) in runs.iter().take(40).enumerate() {
            black_box(run_item(run, iteration % RUN_COUNT == index, 0));
            rendered += 1;
        }
        black_box(run_detail_lines(&runs[iteration % RUN_COUNT]));
        rendered += 1;
    }
    let elapsed = started.elapsed();
    let avg_nanos = elapsed.as_nanos() / rendered as u128;
    eprintln!(
            "perf_render_run_rows_and_detail_lines: rendered={rendered} total_ms={:.3} avg_ns={avg_nanos}",
            elapsed.as_secs_f64() * 1_000.0
        );
}
