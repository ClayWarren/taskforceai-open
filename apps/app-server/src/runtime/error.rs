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

impl std::fmt::Display for RuntimeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{} ({})", self.message, self.code)
    }
}

impl std::error::Error for RuntimeError {}
