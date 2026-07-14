use std::env;

use taskforceai_app_client::{AppClientError, AppServerClient, AppServerRequestHandle};
use taskforceai_app_protocol::*;

use crate::local_coding;
use crate::state::{AppState, EffortSelectorState, UiAction, PRIVATE_CHAT_DISCLOSURE};
use crate::update;
use crate::voice;

use super::format::{
    format_hybrid_mode, format_model_list, format_ollama_ensure, format_ollama_status,
    format_usage_summary,
};
use super::{BackgroundTaskResult, UiTaskQueue};

mod coding;
mod terminal;
mod threads;

fn show_command(state: &mut AppState, title: impl Into<String>, message: impl Into<String>) {
    state.apply(UiAction::CommandExecuted {
        title: title.into(),
        message: message.into(),
    });
}

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
            show_command(state, "Upgrade", message);
            Ok(true)
        }
        // coverage:ignore-end
        LocalCommand::Update(args) => handle_update_command(state, args, background_tasks).await,
        LocalCommand::Usage => handle_usage_command(client, state).await,
        LocalCommand::Private(args) => handle_private_command(client, state, args).await,
        LocalCommand::Voice(args) => {
            handle_voice_command(client, state, args, background_tasks).await
        }
        LocalCommand::Model(args) => handle_model_command(client, state, args).await,
        LocalCommand::Effort(args) => handle_effort_command(client, state, args).await,
        LocalCommand::Ollama(args) => handle_ollama_command(client, state, args).await,
        LocalCommand::Hybrid(args) => handle_hybrid_command(client, state, args).await,
        LocalCommand::Code(args) => handle_code_command(client, state, args).await,
        LocalCommand::Resume(args) => threads::handle_resume(client, state, args).await,
        LocalCommand::Fork(args) => threads::handle_fork(client, state, args).await,
        LocalCommand::Rename(args) => threads::handle_rename(client, state, args).await,
        LocalCommand::Archive(args) => threads::handle_archive(client, state, args).await,
        LocalCommand::Rollback(args) => threads::handle_rollback(client, state, args).await,
        LocalCommand::Diff(args) => coding::handle_diff(client, state, args).await,
        LocalCommand::Review(args) => coding::handle_review(client, state, args).await,
        LocalCommand::Mention(args) => coding::handle_mention(client, state, args).await,
        LocalCommand::Attach(args) => coding::handle_attach(client, state, args).await,
        LocalCommand::Copy => terminal::handle_copy(state),
        LocalCommand::Raw(args) => terminal::handle_raw(state, args),
        LocalCommand::Processes => terminal::handle_processes(state),
        LocalCommand::Stop => terminal::handle_stop(client, state).await,
        LocalCommand::Chat => {
            handle_task_mode_command(client, state, crate::state::TaskMode::Chat).await
        }
        LocalCommand::Work => {
            handle_task_mode_command(client, state, crate::state::TaskMode::Work).await
        }
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
    Usage,
    Private(Vec<&'a str>),
    Voice(Vec<&'a str>),
    Model(Vec<&'a str>),
    Effort(Vec<&'a str>),
    Ollama(Vec<&'a str>),
    Hybrid(Vec<&'a str>),
    Code(Vec<&'a str>),
    Resume(Vec<&'a str>),
    Fork(Vec<&'a str>),
    Rename(Vec<&'a str>),
    Archive(Vec<&'a str>),
    Rollback(Vec<&'a str>),
    Diff(Vec<&'a str>),
    Review(Vec<&'a str>),
    Mention(Vec<&'a str>),
    Attach(Vec<&'a str>),
    Copy,
    Raw(Vec<&'a str>),
    Processes,
    Stop,
    Chat,
    Work,
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
        "/usage" => LocalCommand::Usage,
        "/private" => LocalCommand::Private(parts.collect()),
        "/voice" => LocalCommand::Voice(parts.collect()),
        "/model" => LocalCommand::Model(parts.collect()),
        "/effort" | "/reasoning" => LocalCommand::Effort(parts.collect()),
        "/ollama" => LocalCommand::Ollama(parts.collect()),
        "/hybrid" => LocalCommand::Hybrid(parts.collect()),
        "/code" => LocalCommand::Code(parts.collect()),
        "/resume" => LocalCommand::Resume(parts.collect()),
        "/fork" => LocalCommand::Fork(parts.collect()),
        "/rename" => LocalCommand::Rename(parts.collect()),
        "/archive" => LocalCommand::Archive(parts.collect()),
        "/rollback" | "/undo" => LocalCommand::Rollback(parts.collect()),
        "/diff" => LocalCommand::Diff(parts.collect()),
        "/review" => LocalCommand::Review(parts.collect()),
        "/mention" => LocalCommand::Mention(parts.collect()),
        "/attach" | "/attachments" => LocalCommand::Attach(parts.collect()),
        "/copy" => LocalCommand::Copy,
        "/raw" => LocalCommand::Raw(parts.collect()),
        "/ps" | "/processes" => LocalCommand::Processes,
        "/stop" => LocalCommand::Stop,
        "/chat" => LocalCommand::Chat,
        "/work" => LocalCommand::Work,
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
    show_command(state, result.title, result.message);
    refresh_runtime_state(client, state).await;
    Ok(())
}

async fn refresh_runtime_state(client: &mut AppServerClient, state: &mut AppState) {
    if let Ok(status) = client.status_summary().await {
        state.set_authenticated(status.authenticated);
        state.set_current_model(status.model_id);
        state.pet = status.pet;
    }
}

async fn handle_private_command(
    client: &mut AppServerClient,
    state: &mut AppState,
    args: Vec<&str>,
) -> Result<bool, AppClientError> {
    let action = parse_private_command_args(&args, state.private_chat_enabled);
    match action {
        Ok(Some(true)) => {
            let auth = client.auth_status().await?;
            state.set_authenticated(auth.authenticated);
            if !auth.authenticated {
                show_command(
                    state,
                    "Login Required",
                    "Not authenticated. Use /login first.",
                );
                return Ok(true);
            }
            state.apply(UiAction::PrivateChatSet(true));
        }
        Ok(Some(false)) => {
            state.apply(UiAction::PrivateChatSet(false));
        }
        Ok(None) => {
            let message = if state.private_chat_enabled {
                format!("Enabled.\n{PRIVATE_CHAT_DISCLOSURE}")
            } else {
                "Disabled. Use /private on to start a private chat.".to_string()
            };
            show_command(state, "Private Chat", message);
        }
        Err(message) => {
            show_command(state, "Private Chat", message);
        }
    }
    Ok(true)
}

fn parse_private_command_args(args: &[&str], current: bool) -> Result<Option<bool>, String> {
    match args {
        [] => Ok(Some(!current)),
        ["on" | "enable" | "enabled" | "true"] => Ok(Some(true)),
        ["off" | "disable" | "disabled" | "false"] => Ok(Some(false)),
        ["status"] => Ok(None),
        _ => Err("Usage: /private [on|off|status]".to_string()),
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
            show_command(state, "Login", "Usage: /login poll <device-code>");
            return Ok(true);
        };
        let result = client
            .auth_device_poll(DeviceLoginPollParams {
                device_code: (*device_code).to_string(),
            })
            .await?;
        show_command(
            state,
            "Login",
            format!(
                "Status: {}\n{}",
                result.status,
                result.message.unwrap_or_default()
            ),
        );
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
            show_command(state, "Update", "Checking for updates...");
            background_tasks.push(tokio::spawn(async {
                BackgroundTaskResult::Ui(Box::new(update_check_ui_action().await))
            }));
        }
        "apply" | "install" => {
            show_command(state, "Update", "Checking for updates before install...");
            background_tasks.push(tokio::spawn(async {
                BackgroundTaskResult::Ui(Box::new(update_apply_ui_action().await))
            }));
        }
        // coverage:ignore-end
        "auto" | "status" => {
            let message = format_auto_update_status(update::auto_update_disabled_reason());
            show_command(state, "Update", message);
        }
        _ => {
            show_command(state, "Update", "Usage: /update [check|apply|auto]");
        }
    }
    Ok(true)
}

fn format_auto_update_status(reason: Option<&str>) -> String {
    match reason {
        Some(reason) => format!(
            "Auto-update disabled: {reason}\nNative installs update automatically unless TASKFORCEAI_DISABLE_AUTOUPDATE=1 is set."
        ),
        None => "Auto-update is enabled for this process.".to_string(),
    }
}

async fn handle_usage_command(
    client: &mut AppServerClient,
    state: &mut AppState,
) -> Result<bool, AppClientError> {
    let result = client.usage_summary().await?;
    show_command(state, "Usage", format_usage_summary(&result));
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
            show_command(state, "Voice", voice::status_message());
        }
        "listen" | "dictate" | "append" => {
            spawn_voice_listen(client.request_handle(), state, background_tasks, false)
        }
        "replace" => spawn_voice_listen(client.request_handle(), state, background_tasks, true),
        "realtime" | "voice" => {
            let setup = client
                .voice_realtime_setup(voice::realtime_setup_params())
                .await?;
            show_command(state, "Voice", "Realtime voice turn is listening...");
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
                show_command(state, "Voice", "Nothing to speak.");
                return Ok(true);
            }
            match client
                .voice_speech_generate(VoiceSpeechGenerateParams { text: text.clone() })
                .await
            {
                Ok(result) => match voice::play_generated_speech(&result) {
                    Ok(()) => show_command(state, "Voice", "Speaking."),
                    Err(err) => show_command(state, "Voice", err.to_string()),
                },
                Err(_) => match voice::speak_with_platform_voice(&text) {
                    Ok(()) => show_command(state, "Voice", "Speaking with system voice."),
                    Err(err) => show_command(state, "Voice", err.to_string()),
                },
            };
        }
        "cancel" | "stop" => match voice::cancel_speech() {
            Ok(()) => show_command(state, "Voice", "Speech cancel requested."),
            Err(err) => show_command(state, "Voice", err.to_string()),
        },
        _ => {
            show_command(
                state,
                "Voice",
                "Usage: /voice [status|listen|replace|realtime|speak <text>|cancel]",
            );
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
    show_command(state, "Voice", "Listening...");
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
    if !args.is_empty() {
        show_command(
            state,
            "Code",
            "Code mode uses the directory where TaskForceAI was opened. Usage: /code",
        );
        return Ok(true);
    }
    handle_task_mode_command(client, state, crate::state::TaskMode::Code).await
}

async fn handle_task_mode_command(
    client: &mut AppServerClient,
    state: &mut AppState,
    mode: crate::state::TaskMode,
) -> Result<bool, AppClientError> {
    let workspace = if mode == crate::state::TaskMode::Code {
        Some(local_coding::enable_workspace_tools(client, local_coding::default_workspace()).await?)
    } else {
        let _ = client
            .mcp_remove(McpServerParams {
                name: taskforceai_app_client::local_coding::WORKSPACE_MCP_SERVER_NAME.to_string(),
            })
            .await;
        None
    };
    client
        .quick_mode_set(QuickModeSetParams {
            enabled: mode == crate::state::TaskMode::Chat,
        })
        .await?;
    client
        .autonomous_mode_set(RunModeSetParams { enabled: false })
        .await?;
    state.task_mode = mode;
    state.quick_mode_enabled = mode == crate::state::TaskMode::Chat;
    state.autonomous_mode_enabled = false;
    state.active_thread_id = None;
    state.workspace = workspace
        .as_ref()
        .map(|workspace| workspace.display().to_string());
    show_command(
        state,
        mode.label().to_ascii_uppercase(),
        match mode {
            crate::state::TaskMode::Chat => "Direct single-assistant chat enabled.".to_string(),
            crate::state::TaskMode::Work => {
                "Work mode enabled. Agent Teams remains off until explicitly enabled.".to_string()
            }
            crate::state::TaskMode::Code => format!(
                "Workspace Code mode enabled for {}.",
                workspace
                    .as_ref()
                    .expect("Code mode initializes its workspace")
                    .display()
            ),
        },
    );
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
                show_command(state, "Model", "Usage: /model set <model-id>");
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
        show_command(state, "Model", format_model_list(&result));
    }
    Ok(true)
}

async fn handle_effort_command(
    client: &mut AppServerClient,
    state: &mut AppState,
    args: Vec<&str>,
) -> Result<bool, AppClientError> {
    let result = client.model_list().await?;
    let current_model = result
        .selected_model_id
        .as_deref()
        .unwrap_or(&result.default_model_id);
    state.set_current_model(current_model.to_string());
    let Some(option) = result
        .options
        .iter()
        .find(|option| option.id == current_model)
    else {
        show_command(
            state,
            "Reasoning Effort",
            format!("Model {current_model} is not present in the model catalog."),
        );
        return Ok(true);
    };
    if option.reasoning_effort_levels.is_empty() {
        show_command(
            state,
            "Reasoning Effort",
            format!("Model {current_model} does not expose configurable reasoning effort."),
        );
        return Ok(true);
    }

    let action = args.first().map(|value| value.to_ascii_lowercase());
    if matches!(action.as_deref(), Some("reset" | "default" | "auto")) {
        state.apply(UiAction::ReasoningEffortSet(None));
        return Ok(true);
    }
    if matches!(action.as_deref(), Some("status")) {
        let selected = state
            .reasoning_effort
            .as_deref()
            .or(option.default_reasoning_effort.as_deref())
            .unwrap_or("model default");
        show_command(
            state,
            "Reasoning Effort",
            format!("Model: {current_model}\nSelected: {selected}"),
        );
        return Ok(true);
    }
    if let Some(requested) = action.filter(|value| value != "select") {
        if option
            .reasoning_effort_levels
            .iter()
            .any(|effort| effort == &requested)
        {
            state.apply(UiAction::ReasoningEffortSet(Some(requested)));
        } else {
            show_command(
                state,
                "Reasoning Effort",
                format!(
                    "Unsupported effort for {current_model}. Choose one of: {}.",
                    option.reasoning_effort_levels.join(", ")
                ),
            );
        }
        return Ok(true);
    }

    let selected = state
        .reasoning_effort
        .as_deref()
        .or(option.default_reasoning_effort.as_deref())
        .and_then(|effort| {
            option
                .reasoning_effort_levels
                .iter()
                .position(|candidate| candidate == effort)
        })
        .unwrap_or(0);
    state.apply(UiAction::EffortSelectorOpened(EffortSelectorState {
        model_id: option.id.clone(),
        levels: option.reasoning_effort_levels.clone(),
        selected_index: selected,
    }));
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
            show_command(state, "Ollama", format_ollama_ensure(&result));
        }
        "status" | "recommend" | "recommendation" | "" => {
            let result = client
                .ollama_status(OllamaStatusParams { base_url: None })
                .await?;
            show_command(state, "Ollama", format_ollama_status(&result));
        }
        _ => {
            show_command(
                state,
                "Ollama",
                "Usage: /ollama [status|recommend|ensure [model]]",
            );
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
            show_command(
                state,
                "Hybrid",
                "Usage: /hybrid [status|on [ollama/model]|off]",
            );
            return Ok(true);
        }
    };
    show_command(state, "Hybrid", format_hybrid_mode(&result));
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
mod tests;
