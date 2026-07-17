pub mod client;
pub mod error;
pub mod files;
pub mod stream;
pub mod threads;
pub mod types;
mod validation;

pub use client::TaskForceAI;
pub use error::TaskForceAIError;
pub use files::{File, FileListResponse, FileUploadOptions};
pub use threads::{
    CreateThreadOptions, Thread, ThreadListResponse, ThreadMessage, ThreadMessagesResponse,
    ThreadRunOptions, ThreadRunResponse,
};
pub use types::{
    ImageAttachment, TaskForceAIOptions, TaskStatus, TaskStatusValue, TaskSubmissionOptions,
};

#[cfg(test)]
mod coverage_suite;
