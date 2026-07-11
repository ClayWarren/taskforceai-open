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

pub(crate) fn storage_error(err: impl std::error::Error) -> StoreError {
    StoreError::new(err.to_string())
}

#[cfg(test)]
pub(crate) fn test_unix_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("test clock should be after Unix epoch")
        .as_millis()
}
