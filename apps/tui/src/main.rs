mod app;
mod input;
mod local_coding;
mod state;
mod ui;
mod update;
mod voice;

use std::path::PathBuf;

use crate::app::format::format_generated_media_output;
use clap::{Parser, Subcommand};
use crossterm::{
    event::{DisableMouseCapture, EnableMouseCapture},
    execute, terminal,
};
use ratatui::backend::CrosstermBackend;
use ratatui::Terminal;
use std::io::Write;
use taskforceai_app_client::{
    default_app_server_binary, AppClientError, AppServerClient, AppServerSpawnOptions,
};
use taskforceai_app_protocol::{RunStatus, SubmitRunParams};
use thiserror::Error;

use crate::state::AppState;

const ENABLE_ALTERNATE_SCROLL: &str = "\x1b[?1007h";
const DISABLE_ALTERNATE_SCROLL: &str = "\x1b[?1007l";

#[derive(Debug, Parser)]
#[command(name = "taskforceai")]
#[command(bin_name = "taskforceai")]
#[command(about = "TaskForceAI terminal UI")]
#[command(version)]
struct Cli {
    #[command(subcommand)]
    command: Option<CliCommand>,
    #[arg(long)]
    mock: bool,
    #[arg(long, value_name = "PATH")]
    app_server: Option<PathBuf>,
    #[arg(long, value_name = "PATH")]
    run_store: Option<PathBuf>,
    #[arg(long, help = "Enable workspace-scoped local coding tools for runs")]
    local_coding: bool,
    #[arg(
        long,
        value_name = "PATH",
        help = "Workspace path for --local-coding; defaults to the current directory"
    )]
    workspace: Option<PathBuf>,
    #[arg(long, conflicts_with = "no_mouse")]
    mouse: bool,
    #[arg(long)]
    no_mouse: bool,
    #[arg(long, value_name = "PROMPT")]
    prompt: Option<String>,
    #[arg(long, help = "Use Agent Teams for a headless --prompt run")]
    agent_teams: bool,
    #[arg(
        long,
        value_name = "COUNT",
        help = "Agent count for a headless --prompt run"
    )]
    agent_count: Option<u16>,
    #[arg(long, help = "Enable Computer Use for a headless --prompt run")]
    computer_use: bool,
    #[arg(
        long,
        help = "Run headless Computer Use with logged-in browser/session services"
    )]
    use_logged_in_services: bool,
    #[arg(
        long,
        default_value = "text",
        value_parser = ["text", "json", "streaming-json"],
        help = "Headless output format for --prompt"
    )]
    output_format: String,
}

#[derive(Debug, Subcommand)]
enum CliCommand {
    /// Check for and apply a TaskForceAI CLI update.
    Update {
        #[arg(default_value = "check", value_parser = ["apply", "check"])]
        action: String,
    },
}

#[derive(Debug, Error)]
enum TuiError {
    #[error("terminal IO: {0}")]
    Io(#[from] std::io::Error),
    #[error("app-server client: {0}")]
    Client(#[from] AppClientError),
    #[error("update: {0}")]
    Update(#[from] update::UpdateError),
    #[error("run failed: {0}")]
    RunFailed(String),
    #[error("run canceled")]
    RunCanceled,
    #[error("login required. Use /login first, or set TASKFORCEAI_ALLOW_LOCAL_RUNS=1 for local placeholder runs")]
    LoginRequired,
    #[error("run stream closed before the run reached a terminal state")]
    RunStreamClosed,
}

#[tokio::main]
async fn main() -> Result<(), TuiError> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "taskforceai_tui=info".into()),
        )
        .with_writer(std::io::stderr)
        .init();

    let cli = Cli::parse();
    if let Some(CliCommand::Update { action }) = &cli.command {
        run_update_command(action).await?;
        return Ok(());
    }

    let app_server = cli.app_server.unwrap_or_else(default_app_server_binary);
    let mut client = AppServerClient::spawn_with_options(
        app_server,
        AppServerSpawnOptions {
            run_store_path: cli.run_store,
            ..AppServerSpawnOptions::default()
        },
    )
    .await?;

    if cli.mock {
        run_headless_mock_server(client).await?;
        return Ok(());
    }

    if cli.local_coding {
        let workspace = cli
            .workspace
            .clone()
            .unwrap_or_else(local_coding::default_workspace);
        local_coding::enable_workspace_tools(&mut client, workspace).await?;
    }

    if let Some(prompt) = cli.prompt {
        let prompt_result = run_headless_prompt(
            &mut client,
            HeadlessPromptOptions {
                prompt,
                output_format: &cli.output_format,
                agent_teams: cli.agent_teams,
                agent_count: cli.agent_count,
                computer_use: cli.computer_use,
                use_logged_in_services: cli.use_logged_in_services,
                local_coding: cli.local_coding,
            },
        )
        .await;
        let shutdown_result = client.shutdown().await;
        return match (prompt_result, shutdown_result) {
            (Err(err), _) => Err(err),
            (Ok(()), Err(err)) => Err(err.into()),
            (Ok(()), Ok(())) => Ok(()),
        };
    }

    let initialized = client.initialize().await?;
    let mut state = AppState::new(initialized, Vec::new());

    let mouse_enabled = !cli.no_mouse || cli.mouse;
    let terminal_result = run_terminal(&mut client, &mut state, mouse_enabled).await;
    let shutdown_result = client.shutdown().await;
    match (terminal_result, shutdown_result) {
        (Err(err), _) => Err(err),
        (Ok(()), Err(err)) => Err(err.into()),
        (Ok(()), Ok(())) => Ok(()),
    }
}

async fn run_update_command(action: &str) -> Result<(), TuiError> {
    match update::check_for_update_ignoring_opt_in(env!("CARGO_PKG_VERSION")).await? {
        Some(check) if action == "check" => {
            println!(
                "Update available: {} -> {}",
                check.current_version, check.latest_version
            );
            println!("Archive: {}", check.archive_name);
        }
        Some(check) => {
            println!(
                "Updating TaskForceAI CLI: {} -> {}",
                check.current_version, check.latest_version
            );
            update::apply_update(&check).await?;
            println!(
                "Updated to {}. Restart TaskForceAI to use the new version.",
                check.latest_version
            );
        }
        None => {
            println!("Already on latest version {}.", env!("CARGO_PKG_VERSION"));
        }
    }
    Ok(())
}

struct HeadlessPromptOptions<'a> {
    prompt: String,
    output_format: &'a str,
    agent_teams: bool,
    agent_count: Option<u16>,
    computer_use: bool,
    use_logged_in_services: bool,
    local_coding: bool,
}

async fn run_headless_prompt(
    client: &mut AppServerClient,
    options: HeadlessPromptOptions<'_>,
) -> Result<(), TuiError> {
    if !local_runs_allowed() {
        let auth = client.auth_status().await?;
        if !auth.authenticated {
            return Err(TuiError::LoginRequired);
        }
    }

    let quick_mode = headless_quick_mode(&options);
    let autonomous = options.agent_teams.then_some(true);
    let computer_use = options.computer_use.then_some(true);
    let use_logged_in_services = options
        .computer_use
        .then_some(options.use_logged_in_services);
    let agent_count = headless_agent_count(&options);

    let result = client
        .run_submit(SubmitRunParams {
            prompt: options.prompt,
            model_id: None,
            quick_mode,
            autonomous,
            computer_use,
            computer_use_target: None,
            use_logged_in_services,
            agent_count,
            project_id: None,
            attachment_ids: Vec::new(),
            client_mcp_tools: Vec::new(),
            research_workflow: None,
        })
        .await?;
    let run_id = result.run.id.clone();

    if options.output_format == "streaming-json" {
        println!("{}", serde_json::to_string(&result.run).unwrap_or_default());
    }

    while let Some(event) = client.next_event().await {
        let taskforceai_app_protocol::AppServerEvent::RunUpdated { run } = event else {
            continue;
        };
        if run.id != run_id {
            continue;
        }
        if options.output_format == "streaming-json" {
            println!("{}", serde_json::to_string(&run).unwrap_or_default());
        }
        if matches!(
            run.status,
            RunStatus::Completed | RunStatus::Failed | RunStatus::Canceled
        ) {
            let status = run.status.clone();
            let error = run.error.clone();
            match options.output_format {
                "text" => {
                    if let Some(output) = run.output {
                        println!(
                            "{}",
                            sanitize_terminal_text(&format_generated_media_output(&output))
                        );
                    } else if let Some(error) = &error {
                        eprintln!("{}", sanitize_terminal_text(error));
                    } else {
                        println!("{status:?}");
                    }
                }
                "json" => println!("{}", serde_json::to_string(&run).unwrap_or_default()),
                _ => {}
            }
            return match status {
                RunStatus::Completed => Ok(()),
                RunStatus::Failed => {
                    Err(TuiError::RunFailed(error.unwrap_or_else(|| {
                        "run ended with failed status".to_string()
                    })))
                }
                RunStatus::Canceled => Err(TuiError::RunCanceled),
                RunStatus::Queued | RunStatus::Processing => Ok(()),
            };
        }
    }
    Err(TuiError::RunStreamClosed)
}

fn sanitize_terminal_text(value: &str) -> String {
    value
        .chars()
        .filter(|ch| {
            matches!(*ch, '\n' | '\r' | '\t')
                || (!ch.is_control() && *ch != '\u{7f}' && !('\u{80}'..='\u{9f}').contains(ch))
        })
        .collect()
}

fn headless_quick_mode(options: &HeadlessPromptOptions<'_>) -> Option<bool> {
    if options.computer_use || options.agent_teams || options.local_coding {
        return Some(false);
    }
    None
}

fn headless_agent_count(options: &HeadlessPromptOptions<'_>) -> Option<u16> {
    options
        .agent_count
        .or_else(|| options.agent_teams.then_some(4))
}

fn local_runs_allowed() -> bool {
    std::env::var("TASKFORCEAI_ALLOW_LOCAL_RUNS")
        .is_ok_and(|value| value == "1" || value.eq_ignore_ascii_case("true"))
}

async fn run_headless_mock_server(mut client: AppServerClient) -> Result<(), TuiError> {
    let started = client
        .command_execute(taskforceai_app_protocol::CommandExecuteParams {
            input: "/mock".to_string(),
        })
        .await?;
    println!("{}", started.message);
    println!("Press Ctrl+C to stop.");
    tokio::signal::ctrl_c().await?;
    let stopped = client
        .command_execute(taskforceai_app_protocol::CommandExecuteParams {
            input: "/mock".to_string(),
        })
        .await?;
    println!("{}", stopped.message);
    client.shutdown().await?;
    Ok(())
}

async fn run_terminal(
    client: &mut AppServerClient,
    state: &mut AppState,
    mouse_enabled: bool,
) -> Result<(), TuiError> {
    terminal::enable_raw_mode()?;
    let mut restore = TerminalRestore::new(mouse_enabled);
    let mut stdout = std::io::stdout();
    execute!(stdout, terminal::EnterAlternateScreen)?;
    restore.entered_alternate_screen = true;
    stdout.write_all(ENABLE_ALTERNATE_SCROLL.as_bytes())?;
    restore.enabled_alternate_scroll = true;
    stdout.flush()?;
    if mouse_enabled {
        execute!(stdout, EnableMouseCapture)?;
        restore.enabled_mouse_capture = true;
    }
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let result = app::run_event_loop(client, state, &mut terminal)
        .await
        .map_err(TuiError::Client);

    let cleanup = restore.restore(Some(&mut terminal));
    result?;
    cleanup?;
    Ok(())
}

struct TerminalRestore {
    enabled_raw_mode: bool,
    entered_alternate_screen: bool,
    enabled_alternate_scroll: bool,
    enabled_mouse_capture: bool,
    mouse_enabled: bool,
}

impl TerminalRestore {
    fn new(mouse_enabled: bool) -> Self {
        Self {
            enabled_raw_mode: true,
            entered_alternate_screen: false,
            enabled_alternate_scroll: false,
            enabled_mouse_capture: false,
            mouse_enabled,
        }
    }

    fn restore(
        &mut self,
        terminal: Option<&mut Terminal<CrosstermBackend<std::io::Stdout>>>,
    ) -> std::io::Result<()> {
        let mut first_error = None;
        match terminal {
            Some(terminal) => {
                if self.mouse_enabled && self.enabled_mouse_capture {
                    capture_first_error(
                        &mut first_error,
                        execute!(terminal.backend_mut(), DisableMouseCapture),
                    );
                    self.enabled_mouse_capture = false;
                }
                if self.enabled_alternate_scroll {
                    capture_first_error(
                        &mut first_error,
                        terminal
                            .backend_mut()
                            .write_all(DISABLE_ALTERNATE_SCROLL.as_bytes()),
                    );
                    self.enabled_alternate_scroll = false;
                }
                if self.entered_alternate_screen {
                    capture_first_error(
                        &mut first_error,
                        execute!(terminal.backend_mut(), terminal::LeaveAlternateScreen),
                    );
                    self.entered_alternate_screen = false;
                }
                capture_first_error(&mut first_error, terminal.show_cursor());
            }
            None => {
                let mut stdout = std::io::stdout();
                if self.mouse_enabled && self.enabled_mouse_capture {
                    capture_first_error(&mut first_error, execute!(stdout, DisableMouseCapture));
                    self.enabled_mouse_capture = false;
                }
                if self.enabled_alternate_scroll {
                    capture_first_error(
                        &mut first_error,
                        stdout.write_all(DISABLE_ALTERNATE_SCROLL.as_bytes()),
                    );
                    self.enabled_alternate_scroll = false;
                }
                if self.entered_alternate_screen {
                    capture_first_error(
                        &mut first_error,
                        execute!(stdout, terminal::LeaveAlternateScreen),
                    );
                    self.entered_alternate_screen = false;
                }
            }
        }
        if self.enabled_raw_mode {
            capture_first_error(&mut first_error, terminal::disable_raw_mode());
            self.enabled_raw_mode = false;
        }
        match first_error {
            Some(err) => Err(err),
            None => Ok(()),
        }
    }
}

impl Drop for TerminalRestore {
    fn drop(&mut self) {
        let _ = self.restore(None);
    }
}

fn capture_first_error(first_error: &mut Option<std::io::Error>, result: std::io::Result<()>) {
    if let Err(err) = result {
        if first_error.is_none() {
            *first_error = Some(err);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        headless_agent_count, headless_quick_mode, sanitize_terminal_text, HeadlessPromptOptions,
    };

    fn options() -> HeadlessPromptOptions<'static> {
        HeadlessPromptOptions {
            prompt: "hello".to_string(),
            output_format: "json",
            agent_teams: false,
            agent_count: None,
            computer_use: false,
            use_logged_in_services: false,
            local_coding: false,
        }
    }

    #[test]
    fn agent_teams_headless_options_disable_direct_chat_and_default_to_four_agents() {
        let options = HeadlessPromptOptions {
            agent_teams: true,
            ..options()
        };

        assert_eq!(headless_quick_mode(&options), Some(false));
        assert_eq!(headless_agent_count(&options), Some(4));
    }

    #[test]
    fn explicit_headless_agent_count_wins() {
        let options = HeadlessPromptOptions {
            agent_teams: true,
            agent_count: Some(2),
            ..options()
        };

        assert_eq!(headless_agent_count(&options), Some(2));
    }

    #[test]
    fn computer_use_headless_options_disable_direct_chat_without_forcing_agent_count() {
        let options = HeadlessPromptOptions {
            computer_use: true,
            ..options()
        };

        assert_eq!(headless_quick_mode(&options), Some(false));
        assert_eq!(headless_agent_count(&options), None);
    }

    #[test]
    fn local_coding_headless_options_disable_direct_chat_without_forcing_agent_count() {
        let options = HeadlessPromptOptions {
            local_coding: true,
            ..options()
        };

        assert_eq!(headless_quick_mode(&options), Some(false));
        assert_eq!(headless_agent_count(&options), None);
    }

    #[test]
    fn headless_text_output_strips_terminal_controls() {
        let raw = "ok\x1b]52;c;secret\x07\n\x1b[31mred\x1b[0m\tkeep";
        assert_eq!(
            sanitize_terminal_text(raw),
            "ok]52;c;secret\n[31mred[0m\tkeep"
        );
    }
}
