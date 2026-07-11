use crate::client::TaskForceAI;
use crate::error::TaskForceAIError;
use crate::types::{TaskStatus, TaskSubmissionOptions};
use futures_util::{Stream, StreamExt};
use std::pin::Pin;

const MAX_SSE_LINE_BYTES: usize = 1024 * 1024;

pub type TaskStatusStream =
    Pin<Box<dyn Stream<Item = Result<TaskStatus, TaskForceAIError>> + Send>>;

fn take_sse_line(buffer: &mut Vec<u8>) -> Option<Vec<u8>> {
    let line_end = buffer.iter().position(|byte| *byte == b'\n')?;
    Some(buffer.drain(..line_end + 1).collect())
}

pub(crate) fn parse_sse_line(line: &[u8]) -> Option<Result<TaskStatus, TaskForceAIError>> {
    let line = match std::str::from_utf8(line) {
        Ok(line) => line.trim(),
        Err(err) => {
            return Some(Err(TaskForceAIError::Stream(format!(
                "Invalid UTF-8 in SSE line: {}",
                err
            ))))
        }
    };

    let data = line.strip_prefix("data:")?.trim();
    Some(serde_json::from_str::<TaskStatus>(data).map_err(TaskForceAIError::Serialization))
}

impl TaskForceAI {
    pub async fn stream_task_status(
        &self,
        task_id: &str,
    ) -> Result<TaskStatusStream, TaskForceAIError> {
        if task_id.trim().is_empty() {
            return Err(TaskForceAIError::EmptyTaskId);
        }

        if self.mock_mode {
            let status = self.get_task_status(task_id).await?;
            let stream = futures_util::stream::iter(vec![Ok(status)]);
            return Ok(Box::pin(stream));
        }

        let url = format!("{}/stream/{}", self.base_url, task_id);
        let request = self
            .with_sdk_headers(self.stream_client.get(&url))
            .header("Accept", "text/event-stream");

        let response = request.send().await?;
        if !response.status().is_success() {
            return Err(Self::api_error_from_response(response, "").await);
        }

        let mut bytes_stream = response.bytes_stream();
        let mut buffer: Vec<u8> = Vec::new();

        let s = futures_util::stream::poll_fn(move |cx| {
            loop {
                if let Some(line) = take_sse_line(&mut buffer) {
                    if let Some(result) = parse_sse_line(&line) {
                        return std::task::Poll::Ready(Some(result));
                    }
                    continue;
                }

                match bytes_stream.poll_next_unpin(cx) {
                    std::task::Poll::Ready(Some(Ok(bytes))) => {
                        if buffer.len() + bytes.len() > MAX_SSE_LINE_BYTES {
                            return std::task::Poll::Ready(Some(Err(TaskForceAIError::Stream(
                                format!(
                                    "SSE line exceeded maximum size of {} bytes",
                                    MAX_SSE_LINE_BYTES
                                ),
                            ))));
                        }
                        buffer.extend_from_slice(&bytes);
                        continue;
                    }
                    std::task::Poll::Ready(Some(Err(e))) => {
                        return std::task::Poll::Ready(Some(Err(TaskForceAIError::Network(e))))
                    }
                    std::task::Poll::Ready(None) => {
                        if buffer.is_empty() {
                            return std::task::Poll::Ready(None);
                        } else {
                            // Handle potential last line without newline
                            let line = std::mem::take(&mut buffer);
                            if let Some(result) = parse_sse_line(&line) {
                                return std::task::Poll::Ready(Some(result));
                            }
                            return std::task::Poll::Ready(None);
                        }
                    }
                    std::task::Poll::Pending => return std::task::Poll::Pending,
                }
            }
        });

        Ok(Box::pin(s))
    }

    pub async fn run_task_stream(
        &self,
        prompt: &str,
        options: Option<TaskSubmissionOptions>,
    ) -> Result<TaskStatusStream, TaskForceAIError> {
        let task_id = self.submit_task(prompt, options).await?;
        self.stream_task_status(&task_id).await
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_sse_line, take_sse_line};

    #[test]
    fn buffers_split_utf8_until_complete_line() {
        let mut buffer = Vec::new();
        buffer.extend_from_slice(
            b"data: {\"taskId\":\"task-1\",\"status\":\"completed\",\"result\":\"caf",
        );
        buffer.extend_from_slice(&[0xc3]);
        assert!(take_sse_line(&mut buffer).is_none());

        buffer.extend_from_slice(&[0xa9, b'"', b'}', b'\n']);
        let line = take_sse_line(&mut buffer).expect("complete line");
        let status = parse_sse_line(&line)
            .expect("data line")
            .expect("valid task status");

        assert_eq!(status.result.as_deref(), Some("café"));
    }
}
