#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeError {
    pub code: i64,
    pub message: String,
}

impl RuntimeError {
    pub fn invalid_params(message: impl Into<String>) -> Self {
        Self {
            code: -32602,
            message: message.into(),
        }
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self {
            code: -32004,
            message: message.into(),
        }
    }

    pub fn not_configured(message: impl Into<String>) -> Self {
        Self {
            code: -32010,
            message: message.into(),
        }
    }

    pub fn storage(message: impl Into<String>) -> Self {
        Self {
            code: -32020,
            message: format!("run store error: {}", message.into()),
        }
    }

    pub fn network(message: impl Into<String>) -> Self {
        Self {
            code: -32030,
            message: format!("api error: {}", message.into()),
        }
    }
}

impl From<taskforceai_app_store::StoreError> for RuntimeError {
    fn from(err: taskforceai_app_store::StoreError) -> Self {
        Self::storage(err.to_string())
    }
}

impl std::fmt::Display for RuntimeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{} ({})", self.message, self.code)
    }
}

impl std::error::Error for RuntimeError {}

#[cfg(test)]
mod tests {
    use super::RuntimeError;

    #[test]
    fn store_errors_convert_to_runtime_storage_errors() {
        let path = std::env::temp_dir().join(format!(
            "taskforceai-app-server-store-error-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        std::fs::create_dir_all(&path).expect("test directory should be created");

        let store = taskforceai_app_store::SqliteRunStore::new(path.clone());
        let store_error = store
            .load()
            .expect_err("directory path should fail sqlite open");
        let runtime_error = RuntimeError::from(store_error);

        assert_eq!(runtime_error.code, -32020);
        assert!(runtime_error.message.starts_with("run store error: "));
        assert!(runtime_error.to_string().contains("(-32020)"));

        let _ = std::fs::remove_dir_all(path);
    }
}
