use std::collections::BTreeSet;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::process::Command;

use crate::protocol::{
    AppResponse, GitReviewActionResult, GitReviewCommentAddParams, GitReviewCommentListParams,
    GitReviewCommentListResult, GitReviewCommentRecord, GitReviewCommentResolveParams,
    GitReviewCommentResult, GitReviewDiffFile, GitReviewDiffParams, GitReviewDiffResult,
    GitReviewFileStatus, GitReviewPullRequest, GitReviewPullRequestAction,
    GitReviewPullRequestActionParams, GitReviewPullRequestReview, GitReviewScope,
    GitReviewStageParams, GitReviewStatusParams, GitReviewStatusResult, WorkspaceFileListParams,
    WorkspaceFileListResult, WorkspaceFileReadParams, WorkspaceFileReadResult,
};

use super::error::RuntimeError;
use super::platform::expand_user_path;
use super::util::{unix_millis, value};

const DEFAULT_DIFF_MAX_BYTES: usize = 1024 * 1024;
const HARD_DIFF_MAX_BYTES: usize = 4 * 1024 * 1024;
const DEFAULT_WORKSPACE_FILE_LIMIT: usize = 2_000;
const HARD_WORKSPACE_FILE_LIMIT: usize = 10_000;
const DEFAULT_WORKSPACE_READ_MAX_BYTES: usize = 256 * 1024;
const HARD_WORKSPACE_READ_MAX_BYTES: usize = 1024 * 1024;

impl super::AppRuntime {
    pub fn git_review_status(
        &self,
        params: GitReviewStatusParams,
    ) -> Result<AppResponse, RuntimeError> {
        Ok(value(git_review_status_result(params)?))
    }

    pub fn git_review_diff(
        &self,
        params: GitReviewDiffParams,
    ) -> Result<AppResponse, RuntimeError> {
        let last_turn_paths = if params.scope == GitReviewScope::LastTurn {
            let thread_id = params
                .thread_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    RuntimeError::invalid_params("threadId is required for last-turn review")
                })?;
            let thread = self.find_thread_record(thread_id)?;
            let turn = thread
                .turns
                .last()
                .ok_or_else(|| RuntimeError::invalid_params("thread has no turns to review"))?;
            paths_from_turn_items(&turn.items)
        } else {
            Vec::new()
        };
        Ok(value(git_review_diff_result(params, &last_turn_paths)?))
    }

    pub fn git_review_stage(
        &self,
        params: GitReviewStageParams,
    ) -> Result<AppResponse, RuntimeError> {
        let workspace = resolve_workspace(params.workspace.as_deref())?;
        let root = git_repository_root(&workspace)?
            .ok_or_else(|| RuntimeError::invalid_params("workspace is not a Git repository"))?;
        let paths = validate_git_paths(&params.paths)?;
        let mut args = if params.staged {
            vec!["add".to_string(), "--".to_string()]
        } else if git_ref_exists(&root, "HEAD")? {
            vec![
                "restore".to_string(),
                "--staged".to_string(),
                "--".to_string(),
            ]
        } else {
            vec![
                "rm".to_string(),
                "--cached".to_string(),
                "--ignore-unmatch".to_string(),
                "--".to_string(),
            ]
        };
        args.extend(paths);
        git_output_owned(&root, &args)?;
        Ok(value(git_review_status_result(GitReviewStatusParams {
            workspace: Some(root.display().to_string()),
        })?))
    }

    pub fn git_review_comment_list(
        &self,
        params: GitReviewCommentListParams,
    ) -> Result<AppResponse, RuntimeError> {
        let workspace = canonical_review_workspace(params.workspace.as_deref())?;
        let comments = self
            .metadata_json::<Vec<GitReviewCommentRecord>>("git_review_comments")?
            .unwrap_or_default()
            .into_iter()
            .filter(|comment| comment.workspace == workspace)
            .collect();
        Ok(value(GitReviewCommentListResult { comments }))
    }

    pub fn git_review_comment_add(
        &mut self,
        params: GitReviewCommentAddParams,
    ) -> Result<AppResponse, RuntimeError> {
        let workspace = canonical_review_workspace(params.workspace.as_deref())?;
        let path = validate_git_paths(&[params.path])?
            .into_iter()
            .next()
            .expect("one validated review path");
        if params.line == 0 {
            return Err(RuntimeError::invalid_params(
                "comment line must be positive",
            ));
        }
        if params
            .end_line
            .is_some_and(|end_line| end_line < params.line)
        {
            return Err(RuntimeError::invalid_params(
                "comment endLine must not precede line",
            ));
        }
        let body = params.body.trim();
        if body.is_empty() {
            return Err(RuntimeError::invalid_params("comment body is required"));
        }
        if body.len() > 8_000 {
            return Err(RuntimeError::invalid_params("comment body is too long"));
        }
        let mut comments = self
            .metadata_json::<Vec<GitReviewCommentRecord>>("git_review_comments")?
            .unwrap_or_default();
        let now = unix_millis();
        let id = unique_review_comment_id(&comments, now);
        let comment = GitReviewCommentRecord {
            id,
            workspace,
            path,
            line: params.line,
            end_line: params.end_line,
            body: body.to_string(),
            resolved: false,
            created_at: now,
            updated_at: now,
        };
        comments.push(comment.clone());
        self.set_metadata_json("git_review_comments", &comments)?;
        Ok(value(GitReviewCommentResult { comment }))
    }

    pub fn git_review_comment_resolve(
        &mut self,
        params: GitReviewCommentResolveParams,
    ) -> Result<AppResponse, RuntimeError> {
        let mut comments = self
            .metadata_json::<Vec<GitReviewCommentRecord>>("git_review_comments")?
            .unwrap_or_default();
        let comment = comments
            .iter_mut()
            .find(|comment| comment.id == params.comment_id)
            .ok_or_else(|| RuntimeError::not_found("review comment not found"))?;
        comment.resolved = params.resolved;
        comment.updated_at = unix_millis();
        let result = comment.clone();
        self.set_metadata_json("git_review_comments", &comments)?;
        Ok(value(GitReviewCommentResult { comment: result }))
    }

    pub fn git_review_pull_request_action(
        &self,
        params: GitReviewPullRequestActionParams,
    ) -> Result<AppResponse, RuntimeError> {
        let workspace = resolve_workspace(params.workspace.as_deref())?;
        let root = git_repository_root(&workspace)?
            .ok_or_else(|| RuntimeError::invalid_params("workspace is not a Git repository"))?;
        let body = params
            .body
            .as_deref()
            .map(str::trim)
            .filter(|body| !body.is_empty());
        let args = git_pull_request_args(params.action, body)?;
        let output = command_output_owned("gh", &root, &args)?;
        // coverage:ignore-start -- gh execution is an external CLI boundary; argument and message mapping are tested as pure helpers.
        Ok(value(GitReviewActionResult {
            ok: true,
            message: git_review_action_message(&output),
        }))
        // coverage:ignore-end
    }

    pub fn workspace_file_list(
        &self,
        params: WorkspaceFileListParams,
    ) -> Result<AppResponse, RuntimeError> {
        Ok(value(workspace_file_list_result(params)?))
    }

    pub fn workspace_file_read(
        &self,
        params: WorkspaceFileReadParams,
    ) -> Result<AppResponse, RuntimeError> {
        Ok(value(workspace_file_read_result(params)?))
    }
}

include!("impl_git_review/workspace.rs");
include!("impl_git_review/repository.rs");
include!("impl_git_review/tests.rs");
