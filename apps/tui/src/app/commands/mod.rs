use std::env;

use taskforceai_app_client::{AppClientError, AppServerClient};
use taskforceai_app_protocol::*;

use crate::local_coding;
use crate::state::{AppState, UiAction};
use crate::update;
use crate::voice;

use super::format::{
    format_hybrid_mode, format_model_list, format_ollama_ensure, format_ollama_status,
};
use super::UiTaskQueue;

pub(super) async fn handle_local_command(
    client: &mut AppServerClient,
    state: &mut AppState,
    prompt: &str,
    background_tasks: &mut UiTaskQueue,
) -> Result<bool, AppClientError> {
    match parse_local_command(prompt) {
        LocalCommand::Quit => {
            state.apply(UiAction::QuitRequested);
            Ok(true)
        }
        LocalCommand::Clear => {
            state.apply(UiAction::ClearScreen);
            Ok(true)
        }
        LocalCommand::New => {
            state.apply(UiAction::NewPrompt);
            Ok(true)
        }
        LocalCommand::Login(args) => handle_login_command(client, state, args).await,
        LocalCommand::Upgrade => {
            let url = "https://taskforceai.chat/pricing";
            let message = if open_url(url).is_ok() {
                "Upgrade page opened.".to_string()
            } else {
                format!("Open {url} manually.")
            };
            state.apply(UiAction::CommandExecuted {
                title: "Upgrade".to_string(),
                message,
            });
            Ok(true)
        }
        LocalCommand::Update(args) => handle_update_command(state, args, background_tasks).await,
        LocalCommand::Voice(args) => handle_voice_command(state, args, background_tasks).await,
        LocalCommand::Model(args) => handle_model_command(client, state, args).await,
        LocalCommand::Ollama(args) => handle_ollama_command(client, state, args).await,
        LocalCommand::Hybrid(args) => handle_hybrid_command(client, state, args).await,
        LocalCommand::Code(args) => handle_code_command(client, state, args).await,
        LocalCommand::AppServerCommand => {
            execute_app_server_command(client, state, prompt.to_string()).await?;
            Ok(true)
        }
        LocalCommand::Prompt => Ok(false),
    }
}

#[derive(Debug, PartialEq, Eq)]
enum LocalCommand<'a> {
    Quit,
    Clear,
    New,
    Login(Vec<&'a str>),
    Upgrade,
    Update(Vec<&'a str>),
    Voice(Vec<&'a str>),
    Model(Vec<&'a str>),
    Ollama(Vec<&'a str>),
    Hybrid(Vec<&'a str>),
    Code(Vec<&'a str>),
    AppServerCommand,
    Prompt,
}

fn parse_local_command(prompt: &str) -> LocalCommand<'_> {
    let mut parts = prompt.split_whitespace();
    let command = parts.next().unwrap_or_default();
    match command {
        "/quit" | "/exit" => LocalCommand::Quit,
        "/clear" => LocalCommand::Clear,
        "/new" => LocalCommand::New,
        "/login" => LocalCommand::Login(parts.collect()),
        "/upgrade" => LocalCommand::Upgrade,
        "/update" => LocalCommand::Update(parts.collect()),
        "/voice" => LocalCommand::Voice(parts.collect()),
        "/model" => LocalCommand::Model(parts.collect()),
        "/ollama" => LocalCommand::Ollama(parts.collect()),
        "/hybrid" => LocalCommand::Hybrid(parts.collect()),
        "/code" | "/coding" | "/workspace" => LocalCommand::Code(parts.collect()),
        _ if command.starts_with('/') => LocalCommand::AppServerCommand,
        _ => LocalCommand::Prompt,
    }
}

async fn execute_app_server_command(
    client: &mut AppServerClient,
    state: &mut AppState,
    input: String,
) -> Result<(), AppClientError> {
    let result = client
        .command_execute(CommandExecuteParams { input })
        .await?;
    state.apply(UiAction::CommandExecuted {
        title: result.title,
        message: result.message,
    });
    refresh_runtime_state(client, state).await;
    Ok(())
}

async fn refresh_runtime_state(client: &mut AppServerClient, state: &mut AppState) {
    if let Ok(status) = client.status_summary().await {
        state.set_current_model(status.model_id);
        state.pet = status.pet;
    }
}

async fn handle_login_command(
    client: &mut AppServerClient,
    state: &mut AppState,
    args: Vec<&str>,
) -> Result<bool, AppClientError> {
    if args.first() == Some(&"poll") {
        let Some(device_code) = args.get(1) else {
            state.apply(UiAction::CommandExecuted {
                title: "Login".to_string(),
                message: "Usage: /login poll <device-code>".to_string(),
            });
            return Ok(true);
        };
        let result = client
            .auth_device_poll(DeviceLoginPollParams {
                device_code: (*device_code).to_string(),
            })
            .await?;
        state.apply(UiAction::CommandExecuted {
            title: "Login".to_string(),
            message: format!(
                "Status: {}\n{}",
                result.status,
                result.message.unwrap_or_default()
            ),
        });
        return Ok(true);
    }

    let result = client.auth_device_start().await?;
    let browser_opened = open_url(&result.verification_uri_complete).is_ok();
    state.apply(UiAction::LoginStarted(result));
    if browser_opened {
        state.status_line = "Browser opened for login approval".to_string();
    } else {
        state.status_line = "Open the login URL manually".to_string();
    }
    Ok(true)
}

async fn handle_update_command(
    state: &mut AppState,
    args: Vec<&str>,
    background_tasks: &mut UiTaskQueue,
) -> Result<bool, AppClientError> {
    let action = args.first().copied().unwrap_or("check");
    match action {
        "check" => {
            state.apply(UiAction::CommandExecuted {
                title: "Update".to_string(),
                message: "Checking for updates...".to_string(),
            });
            background_tasks.push(tokio::spawn(update_check_ui_action()));
        }
        "apply" | "install" => {
            state.apply(UiAction::CommandExecuted {
                title: "Update".to_string(),
                message: "Checking for updates before install...".to_string(),
            });
            background_tasks.push(tokio::spawn(update_apply_ui_action()));
        }
        "auto" | "status" => {
            let message = match update::auto_update_disabled_reason() {
                Some(reason) => format!(
                    "Auto-update disabled: {reason}\nSet TASKFORCEAI_ENABLE_AUTOUPDATE=1 to opt in.\nSet TASKFORCEAI_DISABLE_AUTOUPDATE=1 to force-disable."
                ),
                None => "Auto-update opt-in is enabled for this process.".to_string(),
            };
            state.apply(UiAction::CommandExecuted {
                title: "Update".to_string(),
                message,
            });
        }
        _ => {
            state.apply(UiAction::CommandExecuted {
                title: "Update".to_string(),
                message: "Usage: /update [check|apply|auto]".to_string(),
            });
        }
    }
    Ok(true)
}

async fn update_check_ui_action() -> UiAction {
    match update::check_for_update_ignoring_opt_in(env!("CARGO_PKG_VERSION")).await {
        Ok(Some(check)) => UiAction::CommandOutputDisplayed {
            title: "Update".to_string(),
            message: format!(
                "Update available: {} -> {}\nArchive: {}\nRun /update apply to install.",
                check.current_version, check.latest_version, check.archive_name
            ),
        },
        Ok(None) => UiAction::CommandOutputDisplayed {
            title: "Update".to_string(),
            message: format!("Already on latest version {}.", env!("CARGO_PKG_VERSION")),
        },
        Err(err) => UiAction::CommandOutputDisplayed {
            title: "Update".to_string(),
            message: format!("Update check failed: {err}"),
        },
    }
}

async fn update_apply_ui_action() -> UiAction {
    match update::check_for_update_ignoring_opt_in(env!("CARGO_PKG_VERSION")).await {
        Ok(Some(check)) => {
            let latest_version = check.latest_version.clone();
            match update::apply_update(&check).await {
                Ok(()) => UiAction::CommandOutputDisplayed {
                    title: "Update".to_string(),
                    message: format!(
                        "Updated to {latest_version}. Restart TaskForceAI to use the new version."
                    ),
                },
                Err(err) => UiAction::CommandOutputDisplayed {
                    title: "Update".to_string(),
                    message: format!("Update apply failed: {err}"),
                },
            }
        }
        Ok(None) => UiAction::CommandOutputDisplayed {
            title: "Update".to_string(),
            message: format!("Already on latest version {}.", env!("CARGO_PKG_VERSION")),
        },
        Err(err) => UiAction::CommandOutputDisplayed {
            title: "Update".to_string(),
            message: format!("Update check failed: {err}"),
        },
    }
}

async fn handle_voice_command(
    state: &mut AppState,
    args: Vec<&str>,
    background_tasks: &mut UiTaskQueue,
) -> Result<bool, AppClientError> {
    let action = args
        .first()
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_else(|| "status".to_string());
    match action.as_str() {
        "status" | "" => {
            state.apply(UiAction::CommandExecuted {
                title: "Voice".to_string(),
                message: voice::status_message(),
            });
        }
        "listen" | "dictate" | "append" => spawn_voice_listen(state, background_tasks, false),
        "replace" => spawn_voice_listen(state, background_tasks, true),
        "speak" | "say" => {
            let explicit = args.get(1..).unwrap_or_default().join(" ");
            let text = if explicit.trim().is_empty() {
                selected_speakable_text(state)
            } else {
                explicit
            };
            match voice::speak_text(&text) {
                Ok(()) => state.apply(UiAction::CommandExecuted {
                    title: "Voice".to_string(),
                    message: "Speaking.".to_string(),
                }),
                Err(err) => state.apply(UiAction::CommandExecuted {
                    title: "Voice".to_string(),
                    message: err.to_string(),
                }),
            }
        }
        "cancel" | "stop" => match voice::cancel_speech() {
            Ok(()) => state.apply(UiAction::CommandExecuted {
                title: "Voice".to_string(),
                message: "Speech cancel requested.".to_string(),
            }),
            Err(err) => state.apply(UiAction::CommandExecuted {
                title: "Voice".to_string(),
                message: err.to_string(),
            }),
        },
        _ => {
            state.apply(UiAction::CommandExecuted {
                title: "Voice".to_string(),
                message: "Usage: /voice [status|listen|replace|speak <text>|cancel]".to_string(),
            });
        }
    }
    Ok(true)
}

fn spawn_voice_listen(state: &mut AppState, background_tasks: &mut UiTaskQueue, replace: bool) {
    state.apply(UiAction::CommandExecuted {
        title: "Voice".to_string(),
        message: "Listening...".to_string(),
    });
    background_tasks.push(tokio::spawn(async move {
        match voice::listen_transcript().await {
            Ok(transcript) => UiAction::ApplyVoiceTranscript {
                transcript,
                replace,
            },
            Err(err) => UiAction::CommandOutputDisplayed {
                title: "Voice".to_string(),
                message: err.to_string(),
            },
        }
    }));
}

async fn handle_code_command(
    client: &mut AppServerClient,
    state: &mut AppState,
    args: Vec<&str>,
) -> Result<bool, AppClientError> {
    let workspace_arg = args.join(" ");
    if workspace_arg.trim().is_empty() {
        state.apply(UiAction::CommandExecuted {
            title: "Code".to_string(),
            message: "Usage: /code <project-directory>".to_string(),
        });
        return Ok(true);
    }
    let workspace = std::path::PathBuf::from(workspace_arg.trim());
    let workspace = local_coding::enable_workspace_tools(client, workspace).await?;
    state.apply(UiAction::CommandExecuted {
        title: "Code".to_string(),
        message: format!(
            "Workspace tools enabled for {}.\nPrompts will include the workspace MCP server.",
            workspace.display()
        ),
    });
    Ok(true)
}

fn selected_speakable_text(state: &AppState) -> String {
    state
        .selected_run()
        .and_then(|run| run.output.as_ref().or(run.error.as_ref()))
        .cloned()
        .or_else(|| state.command_output.clone())
        .unwrap_or_default()
}

async fn handle_model_command(
    client: &mut AppServerClient,
    state: &mut AppState,
    args: Vec<&str>,
) -> Result<bool, AppClientError> {
    let action = args
        .first()
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_else(|| "status".to_string());
    let result = match action.as_str() {
        "list" | "ls" | "status" => client.model_list().await?,
        "reset" | "default" => client.model_reset().await?,
        "set" | "select" => {
            let model_id = args.get(1..).unwrap_or_default().join(" ");
            if model_id.trim().is_empty() {
                state.apply(UiAction::CommandExecuted {
                    title: "Model".to_string(),
                    message: "Usage: /model set <model-id>".to_string(),
                });
                return Ok(true);
            }
            client
                .model_select(ModelSelectParams {
                    model_id: model_id.trim().to_string(),
                })
                .await?
        }
        _ => {
            let model_id = args.join(" ");
            client
                .model_select(ModelSelectParams {
                    model_id: model_id.trim().to_string(),
                })
                .await?
        }
    };
    let current_model = result
        .selected_model_id
        .clone()
        .unwrap_or_else(|| result.default_model_id.clone());
    state.set_current_model(current_model);
    if matches!(action.as_str(), "list" | "ls" | "status") {
        state.apply(UiAction::ModelSelectorOpened(result));
    } else {
        state.apply(UiAction::CommandExecuted {
            title: "Model".to_string(),
            message: format_model_list(&result),
        });
    }
    Ok(true)
}

async fn handle_ollama_command(
    client: &mut AppServerClient,
    state: &mut AppState,
    args: Vec<&str>,
) -> Result<bool, AppClientError> {
    let action = args
        .first()
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_else(|| "status".to_string());
    match action.as_str() {
        "ensure" | "prepare" | "pull" => {
            let model_id = args
                .get(1..)
                .map(|values| values.join(" "))
                .filter(|value| !value.trim().is_empty());
            let result = client
                .ollama_ensure(OllamaEnsureParams {
                    base_url: None,
                    model_id,
                })
                .await?;
            state.apply(UiAction::CommandExecuted {
                title: "Ollama".to_string(),
                message: format_ollama_ensure(&result),
            });
        }
        "status" | "recommend" | "recommendation" | "" => {
            let result = client
                .ollama_status(OllamaStatusParams { base_url: None })
                .await?;
            state.apply(UiAction::CommandExecuted {
                title: "Ollama".to_string(),
                message: format_ollama_status(&result),
            });
        }
        _ => {
            state.apply(UiAction::CommandExecuted {
                title: "Ollama".to_string(),
                message: "Usage: /ollama [status|recommend|ensure [model]]".to_string(),
            });
        }
    }
    Ok(true)
}

async fn handle_hybrid_command(
    client: &mut AppServerClient,
    state: &mut AppState,
    args: Vec<&str>,
) -> Result<bool, AppClientError> {
    let action = args
        .first()
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_else(|| "status".to_string());
    let result = match action.as_str() {
        "status" | "recommend" | "recommendation" | "" => client.hybrid_mode_get().await?,
        "on" | "enable" | "true" | "1" => {
            let model_id = args
                .get(1..)
                .map(|values| values.join(" "))
                .filter(|value| !value.trim().is_empty());
            client
                .hybrid_mode_set(HybridModeSetParams {
                    enabled: true,
                    model_id,
                    role: None,
                })
                .await?
        }
        "off" | "disable" | "false" | "0" => {
            client
                .hybrid_mode_set(HybridModeSetParams {
                    enabled: false,
                    model_id: None,
                    role: None,
                })
                .await?
        }
        _ => {
            state.apply(UiAction::CommandExecuted {
                title: "Hybrid".to_string(),
                message: "Usage: /hybrid [status|on [ollama/model]|off]".to_string(),
            });
            return Ok(true);
        }
    };
    state.apply(UiAction::CommandExecuted {
        title: "Hybrid".to_string(),
        message: format_hybrid_mode(&result),
    });
    Ok(true)
}

fn open_url(url: &str) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(url).spawn()?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", url])
            .spawn()?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open").arg(url).spawn()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use taskforceai_app_protocol::{
        Capabilities, InitializeResult, RunRecord, RunStatus, ServerInfo, TransportInfo,
    };

    use super::{parse_local_command, selected_speakable_text, LocalCommand};
    use crate::state::{AppState, UiAction};

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

    fn run(id: &str, output: Option<&str>, error: Option<&str>) -> RunRecord {
        RunRecord {
            id: id.to_string(),
            prompt: "prompt".to_string(),
            model_id: None,
            project_id: None,
            status: RunStatus::Completed,
            output: output.map(ToOwned::to_owned),
            error: error.map(ToOwned::to_owned),
            created_at: 1,
            updated_at: 1,
            tool_events: Vec::new(),
            sources: Vec::new(),
            agent_statuses: Vec::new(),
            pending_approval: None,
        }
    }

    #[test]
    fn command_classifier_keeps_ui_only_commands_local() {
        assert_eq!(parse_local_command("/quit"), LocalCommand::Quit);
        assert_eq!(parse_local_command("/exit"), LocalCommand::Quit);
        assert_eq!(parse_local_command("/clear"), LocalCommand::Clear);
        assert_eq!(parse_local_command("/new"), LocalCommand::New);
    }

    #[test]
    fn command_classifier_preserves_args_for_local_handlers() {
        assert_eq!(
            parse_local_command("/login poll device-code"),
            LocalCommand::Login(vec!["poll", "device-code"])
        );
        assert_eq!(
            parse_local_command("/model set ollama/gemma4:31b"),
            LocalCommand::Model(vec!["set", "ollama/gemma4:31b"])
        );
        assert_eq!(
            parse_local_command("/update apply"),
            LocalCommand::Update(vec!["apply"])
        );
        assert_eq!(
            parse_local_command("/voice speak hello world"),
            LocalCommand::Voice(vec!["speak", "hello", "world"])
        );
        assert_eq!(
            parse_local_command("/ollama ensure gemma4:31b"),
            LocalCommand::Ollama(vec!["ensure", "gemma4:31b"])
        );
        assert_eq!(
            parse_local_command("/hybrid on ollama/gemma4:31b"),
            LocalCommand::Hybrid(vec!["on", "ollama/gemma4:31b"])
        );
        assert_eq!(
            parse_local_command("/code /tmp/workspace"),
            LocalCommand::Code(vec!["/tmp/workspace"])
        );
    }

    #[test]
    fn command_classifier_falls_back_to_app_server_for_unknown_slash_commands() {
        assert_eq!(
            parse_local_command("/status"),
            LocalCommand::AppServerCommand
        );
        assert_eq!(
            parse_local_command("/mcp list"),
            LocalCommand::AppServerCommand
        );
        assert_eq!(parse_local_command("plain prompt"), LocalCommand::Prompt);
        assert_eq!(parse_local_command(""), LocalCommand::Prompt);
    }

    #[test]
    fn selected_speakable_text_prefers_selected_run_output_then_error_then_command_output() {
        let mut state = AppState::new(initialized(), vec![run("r1", Some("answer"), None)]);
        state.apply(UiAction::CommandExecuted {
            title: "Status".to_string(),
            message: "ok".to_string(),
        });

        assert_eq!(selected_speakable_text(&state), "answer");

        state.apply(UiAction::HistoryLoaded(vec![run(
            "r2",
            None,
            Some("failed"),
        )]));
        assert_eq!(selected_speakable_text(&state), "failed");

        state.apply(UiAction::HistoryLoaded(Vec::new()));
        state.command_output = Some("Status\nok".to_string());
        assert_eq!(selected_speakable_text(&state), "Status\nok");
    }
}
