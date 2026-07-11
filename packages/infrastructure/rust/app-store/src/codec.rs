use serde_json::Value;

use taskforceai_app_protocol::{PendingPromptStatus, RunStatus};

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

pub(super) fn parse_optional_json_column(
    raw: Option<&str>,
    column: usize,
) -> Result<Option<Value>, rusqlite::Error> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    if raw.trim().is_empty() {
        return Ok(None);
    }
    serde_json::from_str(raw).map(Some).map_err(|err| {
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn attachment_ids_and_json_array_columns_parse_empty_valid_and_invalid_values() {
        assert_eq!(
            parse_attachment_ids(r#"["att-1","att-2"]"#).unwrap(),
            vec!["att-1".to_string(), "att-2".to_string()]
        );
        let err = parse_attachment_ids("not-json").unwrap_err();
        assert!(err.to_string().contains("invalid attachment ids"));

        assert_eq!(
            parse_json_array_column(None, 3).unwrap(),
            Vec::<Value>::new()
        );
        assert_eq!(
            parse_json_array_column(Some("   "), 3).unwrap(),
            Vec::<Value>::new()
        );
        assert_eq!(
            parse_json_array_column(Some(r#"[{"id":1}]"#), 3).unwrap(),
            vec![json!({ "id": 1 })]
        );
        assert_eq!(parse_optional_json_column(None, 4).unwrap(), None);
        assert_eq!(parse_optional_json_column(Some("  "), 4).unwrap(), None);
        assert_eq!(
            parse_optional_json_column(Some(r#"{"id":"approval"}"#), 4).unwrap(),
            Some(json!({ "id": "approval" }))
        );

        match parse_json_array_column(Some("not-json"), 8).unwrap_err() {
            rusqlite::Error::FromSqlConversionFailure(column, rusqlite::types::Type::Text, _) => {
                assert_eq!(column, 8);
            }
            other => panic!("expected JSON conversion failure, got {other:?}"),
        }
        match parse_optional_json_column(Some("not-json"), 9).unwrap_err() {
            rusqlite::Error::FromSqlConversionFailure(column, rusqlite::types::Type::Text, _) => {
                assert_eq!(column, 9);
            }
            other => panic!("expected JSON conversion failure, got {other:?}"),
        }
    }

    #[test]
    fn status_codec_round_trips_all_known_statuses_and_rejects_unknown_values() {
        for (raw, status) in [
            ("queued", RunStatus::Queued),
            ("processing", RunStatus::Processing),
            ("completed", RunStatus::Completed),
            ("failed", RunStatus::Failed),
            ("canceled", RunStatus::Canceled),
        ] {
            assert_eq!(parse_status(raw).unwrap(), status);
            assert_eq!(status_as_str(&status), raw);
        }

        let err = parse_status("stalled").unwrap_err();
        assert_eq!(err.to_string(), "invalid run status stalled");
    }

    #[test]
    fn pending_status_codec_round_trips_and_sqlite_bool_uses_zero_boundary() {
        for (raw, status) in [
            ("queued", PendingPromptStatus::Queued),
            ("pending", PendingPromptStatus::Pending),
            ("failed", PendingPromptStatus::Failed),
        ] {
            assert_eq!(parse_pending_status(raw).unwrap(), status);
            assert_eq!(pending_status_as_str(&status), raw);
        }

        assert!(!sqlite_bool(0));
        assert!(sqlite_bool(1));
        assert!(sqlite_bool(-1));

        let err = parse_pending_status("paused").unwrap_err();
        assert_eq!(err.to_string(), "invalid pending prompt status paused");
    }
}
