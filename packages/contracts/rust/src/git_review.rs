use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GitReviewScope {
    #[default]
    Uncommitted,
    Staged,
    Unstaged,
    AllBranchChanges,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitReviewStatusParams {
    #[serde(default)]
    pub workspace: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitReviewDiffParams {
    #[serde(default)]
    pub workspace: Option<String>,
    #[serde(default)]
    pub scope: GitReviewScope,
    #[serde(default)]
    pub base_ref: Option<String>,
    #[serde(default)]
    pub max_bytes: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitReviewFileStatus {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub index_status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worktree_status: Option<String>,
    pub staged: bool,
    pub unstaged: bool,
    pub untracked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitReviewPullRequestReview {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub submitted_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitReviewPullRequest {
    pub number: u64,
    pub title: String,
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub head_ref_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_ref_name: Option<String>,
    #[serde(default)]
    pub is_draft: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub review_decision: Option<String>,
    pub comment_count: usize,
    pub review_count: usize,
    pub changed_file_count: usize,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub latest_reviews: Vec<GitReviewPullRequestReview>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitReviewStatusResult {
    pub is_git_repository: bool,
    pub workspace: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repository_root: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub head: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub upstream: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_ref: Option<String>,
    pub has_staged_changes: bool,
    pub has_unstaged_changes: bool,
    pub has_untracked_files: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pull_request: Option<GitReviewPullRequest>,
    pub files: Vec<GitReviewFileStatus>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitReviewDiffFile {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitReviewDiffResult {
    pub is_git_repository: bool,
    pub workspace: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repository_root: Option<String>,
    pub scope: GitReviewScope,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_ref: Option<String>,
    pub raw_diff: String,
    pub files: Vec<GitReviewDiffFile>,
    pub truncated: bool,
    pub message: String,
}
