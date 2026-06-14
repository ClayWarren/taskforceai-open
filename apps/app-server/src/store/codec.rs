use serde_json::Value;

use crate::protocol::{PendingPromptStatus, RunStatus};

#[derive(Debug)]
pub(super) struct InvalidAttachmentIDs(serde_json::Error);

impl std::fmt::Display for InvalidAttachmentIDs {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "invalid attachment ids: {}", self.0)
    }
}

impl std::error::Error for InvalidAttachmentIDs {}

pub(super) fn parse_attachment_ids(value: &str) -> Result<Vec<String>, InvalidAttachmentIDs> {
    serde_json::from_str(value).map_err(InvalidAttachmentIDs)
}

pub(super) fn parse_json_array_column(
    raw: Option<&str>,
    column: usize,
) -> Result<Vec<Value>, rusqlite::Error> {
    let Some(raw) = raw else {
        return Ok(Vec::new());
    };
    if raw.trim().is_empty() {
        return Ok(Vec::new());
    }
    serde_json::from_str(raw).map_err(|err| {
        rusqlite::Error::FromSqlConversionFailure(
            column,
            rusqlite::types::Type::Text,
            Box::new(err),
        )
    })
}

pub(super) fn sqlite_bool(value: i64) -> bool {
    value != 0
}

#[derive(Debug)]
pub(super) struct InvalidRunStatus(String);

impl std::fmt::Display for InvalidRunStatus {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "invalid run status {}", self.0)
    }
}

impl std::error::Error for InvalidRunStatus {}

#[derive(Debug)]
pub(super) struct InvalidPendingPromptStatus(String);

impl std::fmt::Display for InvalidPendingPromptStatus {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "invalid pending prompt status {}", self.0)
    }
}

impl std::error::Error for InvalidPendingPromptStatus {}

pub(super) fn parse_status(status: &str) -> Result<RunStatus, InvalidRunStatus> {
    match status {
        "queued" => Ok(RunStatus::Queued),
        "processing" => Ok(RunStatus::Processing),
        "completed" => Ok(RunStatus::Completed),
        "failed" => Ok(RunStatus::Failed),
        "canceled" => Ok(RunStatus::Canceled),
        other => Err(InvalidRunStatus(other.to_string())),
    }
}

pub(super) fn status_as_str(status: &RunStatus) -> &'static str {
    match status {
        RunStatus::Queued => "queued",
        RunStatus::Processing => "processing",
        RunStatus::Completed => "completed",
        RunStatus::Failed => "failed",
        RunStatus::Canceled => "canceled",
    }
}

pub(super) fn parse_pending_status(
    status: &str,
) -> Result<PendingPromptStatus, InvalidPendingPromptStatus> {
    match status {
        "queued" => Ok(PendingPromptStatus::Queued),
        "pending" => Ok(PendingPromptStatus::Pending),
        "failed" => Ok(PendingPromptStatus::Failed),
        other => Err(InvalidPendingPromptStatus(other.to_string())),
    }
}

pub(super) fn pending_status_as_str(status: &PendingPromptStatus) -> &'static str {
    match status {
        PendingPromptStatus::Queued => "queued",
        PendingPromptStatus::Pending => "pending",
        PendingPromptStatus::Failed => "failed",
    }
}
