use crate::error::TaskForceAIError;
use crate::files::{File, FileListResponse};
use crate::threads::{Thread, ThreadListResponse, ThreadMessagesResponse, ThreadRunResponse};
use crate::types::{SubmitTaskResponse, TaskStatus};

fn required_string(value: &str, label: &str, field: &str) -> Result<(), TaskForceAIError> {
    if value.trim().is_empty() {
        return Err(TaskForceAIError::Validation(format!(
            "invalid {label} response: {field} is required"
        )));
    }
    Ok(())
}

fn positive_i64(value: i64, label: &str, field: &str) -> Result<(), TaskForceAIError> {
    if value <= 0 {
        return Err(TaskForceAIError::Validation(format!(
            "invalid {label} response: {field} must be positive"
        )));
    }
    Ok(())
}

fn non_negative_i64(value: i64, label: &str, field: &str) -> Result<(), TaskForceAIError> {
    if value < 0 {
        return Err(TaskForceAIError::Validation(format!(
            "invalid {label} response: {field} must be non-negative"
        )));
    }
    Ok(())
}

pub(crate) fn validate_submit_task_response(
    response: &SubmitTaskResponse,
) -> Result<(), TaskForceAIError> {
    required_string(&response.task_id, "task submission", "taskId")
}

pub(crate) fn validate_task_status(status: &TaskStatus) -> Result<(), TaskForceAIError> {
    required_string(&status.task_id, "task status", "taskId")
}

pub(crate) fn validate_file(file: &File, label: &str) -> Result<(), TaskForceAIError> {
    required_string(&file.id, label, "id")?;
    required_string(&file.filename, label, "filename")?;
    required_string(&file.purpose, label, "purpose")?;
    non_negative_i64(file.bytes, label, "bytes")
}

pub(crate) fn validate_file_list(response: &FileListResponse) -> Result<(), TaskForceAIError> {
    non_negative_i64(response.total, "file list", "total")?;
    for (index, file) in response.files.iter().enumerate() {
        validate_file(file, &format!("file list item {index}"))?;
    }
    Ok(())
}

pub(crate) fn validate_thread(thread: &Thread, label: &str) -> Result<(), TaskForceAIError> {
    positive_i64(thread.id, label, "id")?;
    required_string(&thread.title, label, "title")
}

pub(crate) fn validate_thread_list(response: &ThreadListResponse) -> Result<(), TaskForceAIError> {
    non_negative_i64(response.total, "thread list", "total")?;
    for (index, thread) in response.threads.iter().enumerate() {
        validate_thread(thread, &format!("thread list item {index}"))?;
    }
    Ok(())
}

pub(crate) fn validate_thread_messages(
    response: &ThreadMessagesResponse,
) -> Result<(), TaskForceAIError> {
    non_negative_i64(response.total, "thread messages", "total")?;
    for (index, message) in response.messages.iter().enumerate() {
        let label = format!("thread message {index}");
        positive_i64(message.id, &label, "id")?;
        positive_i64(message.thread_id, &label, "thread_id")?;
        if message.role != "user" && message.role != "assistant" {
            return Err(TaskForceAIError::Validation(format!(
                "invalid {label} response: role is unsupported"
            )));
        }
    }
    Ok(())
}

pub(crate) fn validate_thread_run(response: &ThreadRunResponse) -> Result<(), TaskForceAIError> {
    required_string(&response.task_id, "thread run", "taskId")?;
    if let Some(thread_id) = response.thread_id {
        positive_i64(thread_id, "thread run", "thread_id")?;
    }
    if let Some(message_id) = response.message_id {
        positive_i64(message_id, "thread run", "message_id")?;
    }
    Ok(())
}
