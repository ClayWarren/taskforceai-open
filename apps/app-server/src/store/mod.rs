use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use crate::runtime::RuntimeError;

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

pub(super) fn storage_error(err: impl std::error::Error) -> RuntimeError {
    RuntimeError::storage(err.to_string())
}
