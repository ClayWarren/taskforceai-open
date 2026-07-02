use std::env;

use taskforceai_app_client::{AppClientError, AppServerClient, AppServerRequestHandle};
use taskforceai_app_protocol::*;

use crate::local_coding;
use crate::state::{AppState, UiAction};
use crate::update;
use crate::voice;

use super::format::{
    format_hybrid_mode, format_model_list, format_ollama_ensure, format_ollama_status,
};
use super::{BackgroundTaskResult, UiTaskQueue};

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
        // coverage:ignore-start -- opens the user's browser through the host OS.
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
        // coverage:ignore-end
        LocalCommand::Update(args) => handle_update_command(state, args, background_tasks).await,
        LocalCommand::Voice(args) => {
            handle_voice_command(client, state, args, background_tasks).await
        }
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

// coverage:ignore-start -- device-login start opens a browser through the host OS.
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
// coverage:ignore-end

async fn handle_update_command(
    state: &mut AppState,
    args: Vec<&str>,
    background_tasks: &mut UiTaskQueue,
) -> Result<bool, AppClientError> {
    let action = args.first().copied().unwrap_or("check");
    match action {
        // coverage:ignore-start -- spawns live release-check background tasks.
        "check" => {
            state.apply(UiAction::CommandExecuted {
                title: "Update".to_string(),
                message: "Checking for updates...".to_string(),
            });
            background_tasks.push(tokio::spawn(async {
                BackgroundTaskResult::Ui(Box::new(update_check_ui_action().await))
            }));
        }
        "apply" | "install" => {
            state.apply(UiAction::CommandExecuted {
                title: "Update".to_string(),
                message: "Checking for updates before install...".to_string(),
            });
            background_tasks.push(tokio::spawn(async {
                BackgroundTaskResult::Ui(Box::new(update_apply_ui_action().await))
            }));
        }
        // coverage:ignore-end
        "auto" | "status" => {
            let message = match update::auto_update_disabled_reason() {
                Some(reason) => format!(
                    "Auto-update disabled: {reason}\nSet TASKFORCEAI_ENABLE_AUTOUPDATE=1 to opt in.\nSet TASKFORCEAI_DISABLE_AUTOUPDATE=1 to force-disable."
                ),
                // coverage:ignore-start -- process-env branch covered by update module helper tests.
                None => "Auto-update opt-in is enabled for this process.".to_string(),
                // coverage:ignore-end
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

// coverage:ignore-start -- live release checks and self-update application use network/process IO.
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
// coverage:ignore-end

// coverage:ignore-start -- voice commands call microphone, TTS playback, and realtime gateway IO.
async fn handle_voice_command(
    client: &mut AppServerClient,
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
        "listen" | "dictate" | "append" => {
            spawn_voice_listen(client.request_handle(), state, background_tasks, false)
        }
        "replace" => spawn_voice_listen(client.request_handle(), state, background_tasks, true),
        "realtime" | "voice" => {
            let setup = client
                .voice_realtime_setup(voice::realtime_setup_params())
                .await?;
            state.apply(UiAction::CommandExecuted {
                title: "Voice".to_string(),
                message: "Realtime voice turn is listening...".to_string(),
            });
            background_tasks.push(tokio::spawn(async move {
                BackgroundTaskResult::RealtimeVoice(voice::run_realtime_turn(setup).await)
            }));
        }
        "speak" | "say" => {
            let explicit = args.get(1..).unwrap_or_default().join(" ");
            let text = if explicit.trim().is_empty() {
                selected_speakable_text(state)
            } else {
                explicit
            };
            if text.trim().is_empty() {
                state.apply(UiAction::CommandExecuted {
                    title: "Voice".to_string(),
                    message: "Nothing to speak.".to_string(),
                });
                return Ok(true);
            }
            match client
                .voice_speech_generate(VoiceSpeechGenerateParams { text: text.clone() })
                .await
            {
                Ok(result) => match voice::play_generated_speech(&result) {
                    Ok(()) => state.apply(UiAction::CommandExecuted {
                        title: "Voice".to_string(),
                        message: "Speaking.".to_string(),
                    }),
                    Err(err) => state.apply(UiAction::CommandExecuted {
                        title: "Voice".to_string(),
                        message: err.to_string(),
                    }),
                },
                Err(_) => match voice::speak_with_platform_voice(&text) {
                    Ok(()) => state.apply(UiAction::CommandExecuted {
                        title: "Voice".to_string(),
                        message: "Speaking with system voice.".to_string(),
                    }),
                    Err(err) => state.apply(UiAction::CommandExecuted {
                        title: "Voice".to_string(),
                        message: err.to_string(),
                    }),
                },
            };
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
                message: "Usage: /voice [status|listen|replace|realtime|speak <text>|cancel]"
                    .to_string(),
            });
        }
    }
    Ok(true)
}

fn spawn_voice_listen(
    request_handle: AppServerRequestHandle,
    state: &mut AppState,
    background_tasks: &mut UiTaskQueue,
    replace: bool,
) {
    state.apply(UiAction::CommandExecuted {
        title: "Voice".to_string(),
        message: "Listening...".to_string(),
    });
    background_tasks.push(tokio::spawn(async move {
        BackgroundTaskResult::Ui(Box::new(
            capture_voice_ui_action(request_handle, replace).await,
        ))
    }));
}

async fn capture_voice_ui_action(
    request_handle: AppServerRequestHandle,
    replace: bool,
) -> UiAction {
    match voice::capture_dictation().await {
        Ok(voice::DictationCapture::Transcript(transcript)) => UiAction::ApplyVoiceTranscript {
            transcript,
            replace,
        },
        Ok(voice::DictationCapture::Audio(audio)) => {
            transcribe_voice_ui_action(request_handle, audio, replace).await
        }
        Err(err) => UiAction::CommandOutputDisplayed {
            title: "Voice".to_string(),
            message: err.to_string(),
        },
    }
}

pub(super) async fn transcribe_voice_ui_action(
    request_handle: AppServerRequestHandle,
    audio: voice::RecordedAudio,
    replace: bool,
) -> UiAction {
    match request_handle
        .voice_transcribe(voice::transcribe_params(&audio))
        .await
    {
        Ok(result) => UiAction::ApplyVoiceTranscript {
            transcript: result.text,
            replace,
        },
        Err(err) => UiAction::CommandOutputDisplayed {
            title: "Voice".to_string(),
            message: err.to_string(),
        },
    }
}

pub(super) fn format_realtime_voice_result(
    result: Result<voice::RealtimeTurnResult, voice::VoiceError>,
) -> (String, String) {
    match result {
        Ok(result) => {
            let mut lines = Vec::new();
            if let Some(transcript) = result.user_transcript {
                lines.push(format!("You: {transcript}"));
            }
            if let Some(transcript) = result.assistant_transcript {
                lines.push(format!("TaskForceAI: {transcript}"));
            }
            (
                "Realtime Voice".to_string(),
                if lines.is_empty() {
                    "Realtime voice turn completed.".to_string()
                } else {
                    lines.join("\n")
                },
            )
        }
        Err(err) => ("Realtime Voice".to_string(), err.to_string()),
    }
}
// coverage:ignore-end

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

// coverage:ignore-start -- host OS URL opener.
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
// coverage:ignore-end

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    use futures_util::{stream::FuturesUnordered, StreamExt};
    use serde_json::{json, Value};
    use taskforceai_app_client::AppServerClient;
    use taskforceai_app_protocol::{
        Capabilities, InitializeResult, RunRecord, RunStatus, ServerInfo, TransportInfo,
        JSONRPC_VERSION,
    };

    use super::{
        format_realtime_voice_result, handle_local_command, parse_local_command,
        selected_speakable_text, LocalCommand,
    };
    use crate::app::{BackgroundTaskResult, UiTaskQueue};
    use crate::state::{AppState, UiAction};
    use crate::voice::{LISTEN_COMMAND_ENV, VOICE_ENV_TEST_LOCK};

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

    fn status_summary() -> Value {
        json!({
            "transport": "http",
            "authenticated": true,
            "runCount": 1,
            "modelId": "sentinel",
            "quickMode": false,
            "autonomous": false,
            "computerUse": false,
            "pet": {
                "name": "Sentinel",
                "mood": "focus",
                "visible": true,
                "message": "Ready."
            }
        })
    }

    fn model_list(selected: Option<&str>) -> Value {
        json!({
            "enabled": true,
            "options": [
                {
                    "id": "sentinel",
                    "label": "Sentinel",
                    "badge": "default",
                    "description": "Default model",
                    "usageMultiple": 1.0
                }
            ],
            "defaultModelId": "sentinel",
            "selectedModelId": selected,
            "remoteCatalog": false
        })
    }

    fn ollama_status() -> Value {
        json!({
            "providerId": "ollama",
            "baseUrl": "http://localhost:11434/v1",
            "hostRoot": "http://localhost:11434",
            "connected": true,
            "openaiCompatible": true,
            "responsesSupported": true,
            "version": "0.9.0",
            "models": ["ollama/gemma4:e4b"],
            "defaultModel": "ollama/gemma4:e4b",
            "memory": {
                "totalBytes": 17179869184_u64,
                "totalLabel": "16 GB",
                "recommendedModelId": "ollama/gemma4:e4b",
                "recommendedModel": "Gemma 4 E4B",
                "minimumBytes": 8589934592_u64,
                "reason": "Fits available memory"
            },
            "message": null
        })
    }

    fn hybrid_mode(enabled: bool) -> Value {
        json!({
            "enabled": enabled,
            "role": "Skeptic",
            "modelId": if enabled { json!("ollama/gemma4:e4b") } else { Value::Null },
            "recommendedModelId": "ollama/gemma4:e4b",
            "message": if enabled { "Hybrid reviewer enabled." } else { "Hybrid reviewer disabled." },
            "orchestration": {
                "roles": [
                    {
                        "name": "Skeptic",
                        "description": "Reviews answers before completion.",
                        "modelId": if enabled { json!("ollama/gemma4:e4b") } else { Value::Null }
                    }
                ],
                "budget": null
            }
        })
    }

    fn mcp_server_result(endpoint: &str) -> Value {
        json!({
            "server": {
                "name": "workspace",
                "endpoint": endpoint,
                "tools": [
                    "read_file",
                    "read_multiple_files",
                    "write_file",
                    "edit_file",
                    "create_directory",
                    "list_directory",
                    "list_directory_with_sizes",
                    "directory_tree",
                    "move_file",
                    "search_files",
                    "get_file_info",
                    "list_allowed_directories"
                ],
                "enabled": true
            }
        })
    }

    fn rpc_response(id: Value, result: Value) -> String {
        json!({
            "jsonrpc": JSONRPC_VERSION,
            "id": id,
            "result": result
        })
        .to_string()
    }

    fn start_rpc_sequence_server(
        responses: Vec<(&'static str, Value)>,
    ) -> (String, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("rpc server should bind");
        let address = listener
            .local_addr()
            .expect("rpc address should be readable");
        let server = thread::spawn(move || {
            for (expected_method, result) in responses {
                let (mut stream, _) = listener.accept().expect("rpc request should connect");
                let body = read_http_body(&mut stream);
                let request: Value =
                    serde_json::from_str(&body).expect("rpc request body should be json");
                assert_eq!(request["method"], expected_method);
                let response_body = rpc_response(request["id"].clone(), result);
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    response_body.len(),
                    response_body
                );
                stream
                    .write_all(response.as_bytes())
                    .expect("rpc response should write");
            }
        });
        (format!("http://{address}"), server)
    }

    fn read_http_body(stream: &mut std::net::TcpStream) -> String {
        let mut buffer = Vec::new();
        let mut chunk = [0_u8; 1024];
        let header_end = loop {
            let read = stream.read(&mut chunk).expect("request should read");
            if read == 0 {
                break buffer.len();
            }
            buffer.extend_from_slice(&chunk[..read]);
            if let Some(index) = buffer.windows(4).position(|window| window == b"\r\n\r\n") {
                break index + 4;
            }
        };
        let headers = String::from_utf8_lossy(&buffer[..header_end]);
        let content_length = headers
            .lines()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                name.eq_ignore_ascii_case("content-length")
                    .then(|| value.trim().parse::<usize>().ok())
                    .flatten()
            })
            .unwrap_or(0);
        while buffer.len().saturating_sub(header_end) < content_length {
            let read = stream.read(&mut chunk).expect("request body should read");
            if read == 0 {
                break;
            }
            buffer.extend_from_slice(&chunk[..read]);
        }
        String::from_utf8_lossy(
            &buffer[header_end..header_end + content_length.min(buffer.len() - header_end)],
        )
        .to_string()
    }

    fn restore_env(key: &str, previous: Option<std::ffi::OsString>) {
        if let Some(previous) = previous {
            std::env::set_var(key, previous);
        } else {
            std::env::remove_var(key);
        }
    }

    async fn apply_next_background_task(state: &mut AppState, tasks: &mut UiTaskQueue) {
        let result = tasks
            .next()
            .await
            .expect("background task should be queued")
            .expect("background task should finish");
        match result {
            BackgroundTaskResult::Ui(action) => state.apply(*action),
            BackgroundTaskResult::RealtimeVoice(result) => {
                let (title, message) = format_realtime_voice_result(result);
                state.apply(UiAction::CommandOutputDisplayed { title, message });
            }
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

    #[tokio::test]
    async fn local_command_handlers_drive_app_server_rpc_and_update_state() {
        let (base_url, server) = start_rpc_sequence_server(vec![
            ("model.list", model_list(None)),
            ("model.select", model_list(Some("gpt-5"))),
            ("ollama.status", ollama_status()),
            (
                "ollama.ensure",
                json!({
                    "status": ollama_status(),
                    "model": "ollama/gemma4:e4b",
                    "pulled": true,
                    "pullEvents": [{"type": "success"}]
                }),
            ),
            ("hybridMode.get", hybrid_mode(false)),
            ("hybridMode.set", hybrid_mode(true)),
            ("hybridMode.set", hybrid_mode(false)),
            (
                "auth.devicePoll",
                json!({
                    "status": "approved",
                    "token": "token",
                    "expiresIn": 3600,
                    "interval": 5,
                    "message": "Approved"
                }),
            ),
            (
                "command.execute",
                json!({
                    "handled": true,
                    "title": "Status",
                    "message": "App-server ok"
                }),
            ),
            ("status.summary", status_summary()),
        ]);
        let mut client = AppServerClient::connect_http(base_url, "session-token")
            .expect("test client should connect");
        let mut state = AppState::new(initialized(), Vec::new());
        let mut tasks: UiTaskQueue = FuturesUnordered::new();

        assert!(
            handle_local_command(&mut client, &mut state, "/model list", &mut tasks)
                .await
                .expect("model list should succeed")
        );
        assert!(state.model_selector_active());

        assert!(
            handle_local_command(&mut client, &mut state, "/model set gpt-5", &mut tasks)
                .await
                .expect("model select should succeed")
        );
        assert_eq!(state.current_model_id, "gpt-5");
        assert!(state
            .command_output
            .as_deref()
            .expect("model command output")
            .contains("gpt-5"));

        assert!(
            handle_local_command(&mut client, &mut state, "/ollama status", &mut tasks)
                .await
                .expect("ollama status should succeed")
        );
        assert!(state
            .command_output
            .as_deref()
            .expect("ollama status output")
            .contains("connected: true"));

        assert!(handle_local_command(
            &mut client,
            &mut state,
            "/ollama ensure ollama/gemma4:e4b",
            &mut tasks,
        )
        .await
        .expect("ollama ensure should succeed"));
        assert!(state
            .command_output
            .as_deref()
            .expect("ollama ensure output")
            .contains("pulled: true"));

        assert!(
            handle_local_command(&mut client, &mut state, "/hybrid status", &mut tasks)
                .await
                .expect("hybrid status should succeed")
        );
        assert!(state
            .command_output
            .as_deref()
            .expect("hybrid status output")
            .contains("enabled: false"));

        assert!(handle_local_command(
            &mut client,
            &mut state,
            "/hybrid on ollama/gemma4:e4b",
            &mut tasks,
        )
        .await
        .expect("hybrid enable should succeed"));
        assert!(state
            .command_output
            .as_deref()
            .expect("hybrid enable output")
            .contains("enabled: true"));

        assert!(
            handle_local_command(&mut client, &mut state, "/hybrid off", &mut tasks)
                .await
                .expect("hybrid disable should succeed")
        );
        assert!(state
            .command_output
            .as_deref()
            .expect("hybrid disable output")
            .contains("enabled: false"));

        assert!(
            handle_local_command(&mut client, &mut state, "/login poll device", &mut tasks)
                .await
                .expect("login poll should succeed")
        );
        assert!(state
            .command_output
            .as_deref()
            .expect("login output")
            .contains("Approved"));

        assert!(
            handle_local_command(&mut client, &mut state, "/status", &mut tasks)
                .await
                .expect("delegated command should succeed")
        );
        assert_eq!(state.current_model_id, "sentinel");
        assert!(state
            .command_output
            .as_deref()
            .expect("status output")
            .contains("App-server ok"));

        server.join().expect("rpc sequence should finish");
    }

    #[tokio::test]
    async fn local_command_handlers_cover_ui_only_and_usage_branches() {
        let (base_url, server) = start_rpc_sequence_server(Vec::new());
        let mut client = AppServerClient::connect_http(base_url, "session-token")
            .expect("test client should connect");
        let mut state = AppState::new(initialized(), Vec::new());
        let mut tasks: UiTaskQueue = FuturesUnordered::new();

        assert!(
            handle_local_command(&mut client, &mut state, "/new", &mut tasks)
                .await
                .expect("new command should succeed")
        );
        assert_eq!(state.status_line, "New prompt");
        assert!(
            !handle_local_command(&mut client, &mut state, "plain prompt", &mut tasks)
                .await
                .expect("plain prompt should not be handled locally")
        );

        state.prompt_input = "text".to_string();
        state.command_output = Some("output".to_string());
        assert!(
            handle_local_command(&mut client, &mut state, "/clear", &mut tasks)
                .await
                .expect("clear command should succeed")
        );
        assert_eq!(state.prompt_input, "");
        assert_eq!(state.command_output, None);

        assert!(
            handle_local_command(&mut client, &mut state, "/update auto", &mut tasks)
                .await
                .expect("update auto command should succeed")
        );
        assert!(state
            .command_output
            .as_deref()
            .expect("update auto output")
            .contains("Auto-update"));

        assert!(
            handle_local_command(&mut client, &mut state, "/update banana", &mut tasks)
                .await
                .expect("invalid update command should succeed")
        );
        assert_eq!(
            state.command_output.as_deref(),
            Some("Update\nUsage: /update [check|apply|auto]")
        );

        assert!(
            handle_local_command(&mut client, &mut state, "/voice status", &mut tasks)
                .await
                .expect("voice status command should succeed")
        );
        assert!(state
            .command_output
            .as_deref()
            .expect("voice status output")
            .contains("Voice"));

        state.command_output = None;
        assert!(
            handle_local_command(&mut client, &mut state, "/voice speak", &mut tasks)
                .await
                .expect("empty voice speak command should succeed")
        );
        assert_eq!(
            state.command_output.as_deref(),
            Some("Voice\nNothing to speak.")
        );

        assert!(
            handle_local_command(&mut client, &mut state, "/voice nope", &mut tasks)
                .await
                .expect("invalid voice command should succeed")
        );
        assert_eq!(
            state.command_output.as_deref(),
            Some("Voice\nUsage: /voice [status|listen|replace|realtime|speak <text>|cancel]")
        );

        assert!(
            handle_local_command(&mut client, &mut state, "/model set", &mut tasks)
                .await
                .expect("empty model set command should succeed")
        );
        assert_eq!(
            state.command_output.as_deref(),
            Some("Model\nUsage: /model set <model-id>")
        );

        assert!(
            handle_local_command(&mut client, &mut state, "/login poll", &mut tasks)
                .await
                .expect("missing login poll device code should succeed")
        );
        assert_eq!(
            state.command_output.as_deref(),
            Some("Login\nUsage: /login poll <device-code>")
        );

        assert!(
            handle_local_command(&mut client, &mut state, "/ollama nope", &mut tasks)
                .await
                .expect("invalid ollama command should succeed")
        );
        assert_eq!(
            state.command_output.as_deref(),
            Some("Ollama\nUsage: /ollama [status|recommend|ensure [model]]")
        );

        assert!(
            handle_local_command(&mut client, &mut state, "/hybrid nope", &mut tasks)
                .await
                .expect("invalid hybrid command should succeed")
        );
        assert_eq!(
            state.command_output.as_deref(),
            Some("Hybrid\nUsage: /hybrid [status|on [ollama/model]|off]")
        );

        assert!(
            handle_local_command(&mut client, &mut state, "/code", &mut tasks)
                .await
                .expect("empty code command should succeed")
        );
        assert_eq!(
            state.command_output.as_deref(),
            Some("Code\nUsage: /code <project-directory>")
        );

        assert!(
            handle_local_command(&mut client, &mut state, "/quit", &mut tasks)
                .await
                .expect("quit command should succeed")
        );
        assert!(state.should_quit);

        server.join().expect("empty rpc sequence should finish");
    }

    #[tokio::test]
    async fn local_model_and_code_commands_cover_reset_shorthand_and_workspace_success() {
        let workspace = tempfile::tempdir().expect("workspace temp dir");
        let workspace_path = workspace.path().canonicalize().expect("workspace path");
        let endpoint = format!(
            "stdio:bunx @modelcontextprotocol/server-filesystem \"{}\"",
            workspace_path
                .to_string_lossy()
                .replace('\\', "\\\\")
                .replace('"', "\\\"")
        );
        let (base_url, server) = start_rpc_sequence_server(vec![
            ("model.reset", model_list(None)),
            ("model.select", model_list(Some("claude-sonnet"))),
            ("mcp.add", mcp_server_result(&endpoint)),
            ("mcp.tools", mcp_server_result(&endpoint)),
        ]);
        let mut client = AppServerClient::connect_http(base_url, "session-token")
            .expect("test client should connect");
        let mut state = AppState::new(initialized(), Vec::new());
        let mut tasks: UiTaskQueue = FuturesUnordered::new();

        handle_local_command(&mut client, &mut state, "/model reset", &mut tasks)
            .await
            .expect("model reset should succeed");
        assert_eq!(state.current_model_id, "sentinel");

        handle_local_command(&mut client, &mut state, "/model claude-sonnet", &mut tasks)
            .await
            .expect("model shorthand should select");
        assert_eq!(state.current_model_id, "claude-sonnet");

        handle_local_command(
            &mut client,
            &mut state,
            &format!("/code {}", workspace_path.display()),
            &mut tasks,
        )
        .await
        .expect("code workspace command should enable tools");
        assert!(state
            .command_output
            .as_deref()
            .expect("code output")
            .contains("Workspace tools enabled"));

        server
            .join()
            .expect("model/code rpc sequence should finish");
    }

    #[allow(clippy::await_holding_lock)]
    #[tokio::test(flavor = "current_thread")]
    async fn local_voice_commands_cover_dictation_speech_and_realtime_errors() {
        let _guard = VOICE_ENV_TEST_LOCK.lock().expect("voice env test lock");
        let (base_url, server) = start_rpc_sequence_server(vec![
            (
                "voice.speechGenerate",
                json!({
                    "audioBase64": "",
                    "mediaType": "audio/mpeg",
                    "format": "mp3"
                }),
            ),
            (
                "voice.realtimeSetup",
                json!({
                    "token": "",
                    "url": "",
                    "expiresAt": null,
                    "tools": null
                }),
            ),
        ]);
        let mut client = AppServerClient::connect_http(base_url, "session-token")
            .expect("test client should connect");
        let mut state = AppState::new(initialized(), Vec::new());
        let mut tasks: UiTaskQueue = FuturesUnordered::new();

        let previous = std::env::var_os(LISTEN_COMMAND_ENV);
        std::env::set_var(LISTEN_COMMAND_ENV, "printf ' dictated text\\n'");
        handle_local_command(&mut client, &mut state, "/voice listen", &mut tasks)
            .await
            .expect("voice listen command should succeed");
        assert_eq!(state.command_output.as_deref(), Some("Voice\nListening..."));
        apply_next_background_task(&mut state, &mut tasks).await;
        restore_env(LISTEN_COMMAND_ENV, previous);
        assert_eq!(state.prompt_input, "dictated text");

        state.prompt_input = "replace me".to_string();
        let previous = std::env::var_os(LISTEN_COMMAND_ENV);
        std::env::set_var(LISTEN_COMMAND_ENV, "printf 'replacement\\n'");
        handle_local_command(&mut client, &mut state, "/voice replace", &mut tasks)
            .await
            .expect("voice replace command should succeed");
        apply_next_background_task(&mut state, &mut tasks).await;
        restore_env(LISTEN_COMMAND_ENV, previous);
        assert_eq!(state.prompt_input, "replacement");

        handle_local_command(&mut client, &mut state, "/voice speak hello", &mut tasks)
            .await
            .expect("voice speak command should handle playback error");
        assert!(state
            .command_output
            .as_deref()
            .expect("voice speak output")
            .contains("empty audio"));

        handle_local_command(&mut client, &mut state, "/voice realtime", &mut tasks)
            .await
            .expect("voice realtime command should handle setup error");
        assert_eq!(
            state.command_output.as_deref(),
            Some("Voice\nRealtime voice turn is listening...")
        );
        apply_next_background_task(&mut state, &mut tasks).await;
        assert!(state
            .command_output
            .as_deref()
            .expect("voice realtime output")
            .contains("invalid session data"));

        server.join().expect("voice rpc sequence should finish");
    }
}
