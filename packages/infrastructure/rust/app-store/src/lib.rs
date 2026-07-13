use std::path::PathBuf;
use std::sync::{Arc, Mutex};

mod changes;
mod codec;
mod conversations;
mod metadata;
mod queue;
mod runs;
mod schema;

#[derive(Debug, Clone)]
pub struct SqliteRunStore {
    path: PathBuf,
    schema_initialized: Arc<Mutex<bool>>,
}

impl SqliteRunStore {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            schema_initialized: Arc::new(Mutex::new(false)),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoreError {
    message: String,
}

impl StoreError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for StoreError {}

pub type StoreResult<T> = Result<T, StoreError>;

impl From<rusqlite::Error> for StoreError {
    fn from(error: rusqlite::Error) -> Self {
        Self::new(error.to_string())
    }
}

impl From<serde_json::Error> for StoreError {
    fn from(error: serde_json::Error) -> Self {
        Self::new(error.to_string())
    }
}

impl From<std::io::Error> for StoreError {
    fn from(error: std::io::Error) -> Self {
        Self::new(error.to_string())
    }
}

#[cfg(test)]
pub(crate) fn test_unix_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("test clock should be after Unix epoch")
        .as_millis()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_display_preserved<E: std::error::Error>(error: E)
    where
        StoreError: From<E>,
    {
        let expected = error.to_string();
        assert_eq!(StoreError::from(error).to_string(), expected);
    }

    #[test]
    fn source_error_conversions_preserve_display_strings() {
        assert_display_preserved(rusqlite::Error::InvalidQuery);
        assert_display_preserved(
            serde_json::from_str::<serde_json::Value>("{").expect_err("JSON should be invalid"),
        );
        assert_display_preserved(std::io::Error::other("storage failure"));
    }
}
