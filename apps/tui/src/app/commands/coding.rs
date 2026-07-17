use taskforceai_app_client::{AppClientError, AppServerClient};
use taskforceai_app_protocol::{
    AttachmentAddParams, GitReviewDiffParams, GitReviewScope, GitReviewStatusParams,
    WorkspaceFileListParams,
};

use crate::state::AppState;

use super::show_command;

pub(super) async fn handle_diff(
    client: &mut AppServerClient,
    state: &mut AppState,
    args: Vec<&str>,
) -> Result<bool, AppClientError> {
    if !require_code_mode(state, "Diff") {
        return Ok(true);
    }
    let scope = parse_scope(args.first().copied());
    let result = client
        .git_review_diff(GitReviewDiffParams {
            workspace: state.workspace.clone(),
            scope,
            base_ref: args.get(1).map(|value| (*value).to_string()),
            max_bytes: Some(1024 * 1024),
            thread_id: None,
        })
        .await?;
    let mut output = result.raw_diff;
    if output.trim().is_empty() {
        output = result.message;
    }
    if result.truncated {
        output.push_str("\n\n[Diff truncated at 1 MiB]");
    }
    show_command(state, "Diff", output);
    Ok(true)
}

pub(super) async fn handle_review(
    client: &mut AppServerClient,
    state: &mut AppState,
    args: Vec<&str>,
) -> Result<bool, AppClientError> {
    if !require_code_mode(state, "Review") {
        return Ok(true);
    }
    let scope = parse_scope(args.first().copied());
    let status = client
        .git_review_status(GitReviewStatusParams {
            workspace: state.workspace.clone(),
        })
        .await?;
    if !status.is_git_repository {
        show_command(state, "Review", status.message);
        return Ok(true);
    }
    let diff = client
        .git_review_diff(GitReviewDiffParams {
            workspace: state.workspace.clone(),
            scope,
            base_ref: args.get(1).map(|value| (*value).to_string()),
            max_bytes: Some(2 * 1024 * 1024),
            thread_id: None,
        })
        .await?;
    if diff.raw_diff.trim().is_empty() {
        show_command(
            state,
            "Review",
            "No changes were found for that review scope.",
        );
        return Ok(true);
    }
    let branch = status.branch.as_deref().unwrap_or("detached HEAD");
    let prompt = format!(
        "Review the following {scope:?} changes on branch {branch}. Find concrete correctness, security, regression, and maintainability issues. Report only actionable findings with file and line evidence, ordered by severity.\n\n{}",
        diff.raw_diff
    );
    crate::app::submit_task_prompt(client, state, prompt).await?;
    state.status_line = "Code review started".to_string();
    Ok(true)
}

pub(super) async fn handle_mention(
    client: &mut AppServerClient,
    state: &mut AppState,
    args: Vec<&str>,
) -> Result<bool, AppClientError> {
    if !require_code_mode(state, "Mention") {
        return Ok(true);
    }
    let query = args.join(" ");
    let result = client
        .workspace_file_list(WorkspaceFileListParams {
            workspace: state.workspace.clone(),
            query: (!query.trim().is_empty()).then(|| query.trim().to_string()),
            limit: Some(20),
        })
        .await?;
    let Some(first) = result.files.first().cloned() else {
        show_command(state, "Mention", "No matching workspace files.");
        return Ok(true);
    };
    let list = result
        .files
        .iter()
        .enumerate()
        .map(|(index, path)| format!("{} {path}", if index == 0 { ">" } else { " " }))
        .collect::<Vec<_>>()
        .join("\n");
    show_command(state, "Mention", list);
    state.prompt_input = format!("{} ", crate::local_coding::format_workspace_mention(&first));
    state.prompt_cursor = state.prompt_input.len();
    state.refresh_command_suggestions();
    state.status_line = format!("Mentioned {first}");
    Ok(true)
}

pub(super) async fn handle_attach(
    client: &mut AppServerClient,
    state: &mut AppState,
    args: Vec<&str>,
) -> Result<bool, AppClientError> {
    let value = args.join(" ");
    match value.trim() {
        "" | "list" => {
            let result = client.attachment_list().await?;
            state.attachments = result.attachments;
        }
        "clear" => {
            let result = client.attachment_clear().await?;
            state.attachments = result.attachments;
        }
        path => {
            let result = client
                .attachment_add(AttachmentAddParams {
                    path: path.to_string(),
                })
                .await?;
            state.attachments = result.attachments;
        }
    }
    let message = if state.attachments.is_empty() {
        "No attachments staged. Use /attach <path> to add one.".to_string()
    } else {
        state
            .attachments
            .iter()
            .map(|attachment| {
                format!(
                    "{} · {} · {} bytes",
                    attachment.name, attachment.mime_type, attachment.size
                )
            })
            .collect::<Vec<_>>()
            .join("\n")
    };
    show_command(state, "Attachments", message);
    Ok(true)
}

fn parse_scope(value: Option<&str>) -> GitReviewScope {
    match value.map(str::to_ascii_lowercase).as_deref() {
        Some("staged") => GitReviewScope::Staged,
        Some("unstaged") => GitReviewScope::Unstaged,
        Some("branch") | Some("all") => GitReviewScope::AllBranchChanges,
        _ => GitReviewScope::Uncommitted,
    }
}

fn require_code_mode(state: &mut AppState, title: &str) -> bool {
    if state.task_mode == crate::state::TaskMode::Code {
        return true;
    }
    show_command(
        state,
        title,
        "This is a Code-mode command. Use /code <project-directory> first.",
    );
    false
}
