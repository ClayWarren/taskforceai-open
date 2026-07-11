use crate::client::TaskForceAI;
use crate::error::TaskForceAIError;
use crate::validation::{validate_file, validate_file_list};
use bytes::{Bytes, BytesMut};
use chrono::{DateTime, Utc};
use percent_encoding::{utf8_percent_encode, AsciiSet, CONTROLS};
use reqwest::multipart::{Form, Part};
use serde::{Deserialize, Serialize};

#[cfg(not(test))]
const MAX_DOWNLOAD_SIZE_BYTES: usize = 50 * 1024 * 1024;
#[cfg(test)]
const MAX_DOWNLOAD_SIZE_BYTES: usize = 16;

const PATH_SEGMENT_ENCODE_SET: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'"')
    .add(b'#')
    .add(b'$')
    .add(b'%')
    .add(b'&')
    .add(b'\'')
    .add(b'(')
    .add(b')')
    .add(b'*')
    .add(b'+')
    .add(b',')
    .add(b'/')
    .add(b':')
    .add(b';')
    .add(b'<')
    .add(b'=')
    .add(b'>')
    .add(b'?')
    .add(b'@')
    .add(b'[')
    .add(b'\\')
    .add(b']')
    .add(b'^')
    .add(b'`')
    .add(b'{')
    .add(b'|')
    .add(b'}');

fn encode_path_segment(segment: &str) -> String {
    utf8_percent_encode(segment, PATH_SEGMENT_ENCODE_SET).to_string()
}

/// Represents an uploaded file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct File {
    pub id: String,
    pub filename: String,
    pub purpose: String,
    pub bytes: i64,
    #[serde(with = "chrono::serde::ts_seconds")]
    pub created_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
}

/// Options for uploading a file.
#[derive(Debug, Clone, Default)]
pub struct FileUploadOptions {
    pub purpose: Option<String>,
    pub mime_type: Option<String>,
}

/// Response containing a list of files.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileListResponse {
    pub files: Vec<File>,
    pub total: i64,
}

#[derive(Debug, Deserialize)]
struct AttachmentUploadResponse {
    id: String,
}

impl TaskForceAI {
    /// Uploads a transient task attachment and returns its attachment ID.
    pub async fn upload_attachment(
        &self,
        filename: &str,
        content: Bytes,
        mime_type: Option<&str>,
    ) -> Result<String, TaskForceAIError> {
        let mut part = Part::bytes(content.to_vec()).file_name(filename.to_string());
        if let Some(mime_type) = mime_type {
            part = part
                .mime_str(mime_type)
                .map_err(|e| TaskForceAIError::Other(e.to_string()))?;
        }
        let form = Form::new().part("file", part);
        let url = format!("{}/attachments/upload", self.api_root_url());
        let response = self
            .with_sdk_headers(self.client.post(&url).multipart(form))
            .send()
            .await?;
        let status = response.status();
        if !status.is_success() {
            return Err(
                Self::api_error_from_response(response, "Failed to read error message").await,
            );
        }

        let uploaded: AttachmentUploadResponse = response.json().await?;
        if uploaded.id.trim().is_empty() {
            return Err(TaskForceAIError::Other(
                "Invalid attachment upload response: id is required".to_string(),
            ));
        }
        Ok(uploaded.id)
    }

    /// Uploads a file to the API.
    pub async fn upload_file(
        &self,
        filename: &str,
        content: Bytes,
        options: Option<FileUploadOptions>,
    ) -> Result<File, TaskForceAIError> {
        let mime_type = options
            .as_ref()
            .and_then(|o| o.mime_type.clone())
            .unwrap_or_else(|| "application/octet-stream".to_string());

        let mut form = Form::new().part(
            "file",
            Part::bytes(content.to_vec())
                .file_name(filename.to_string())
                .mime_str(&mime_type)
                .map_err(|e| TaskForceAIError::Other(e.to_string()))?,
        );

        if let Some(opts) = options {
            if let Some(purpose) = opts.purpose {
                form = form.text("purpose", purpose);
            }
            if let Some(mime_type) = opts.mime_type {
                form = form.text("mime_type", mime_type);
            }
        }

        let url = format!("{}/files", self.base_url);
        let response = self
            .with_sdk_headers(self.client.post(&url).multipart(form))
            .send()
            .await?;
        let status = response.status();

        if !status.is_success() {
            return Err(
                Self::api_error_from_response(response, "Failed to read error message").await,
            );
        }

        let file: File = response.json().await?;
        validate_file(&file, "upload file")?;
        Ok(file)
    }

    /// Retrieves a list of uploaded files.
    pub async fn list_files(
        &self,
        limit: i32,
        offset: i32,
    ) -> Result<FileListResponse, TaskForceAIError> {
        let path = format!("/files?limit={}&offset={}", limit, offset);
        let response: FileListResponse = self.request(reqwest::Method::GET, &path, None).await?;
        validate_file_list(&response)?;
        Ok(response)
    }

    /// Retrieves metadata for a specific file.
    pub async fn get_file(&self, file_id: &str) -> Result<File, TaskForceAIError> {
        let path = format!("/files/{}", encode_path_segment(file_id));
        let file: File = self.request(reqwest::Method::GET, &path, None).await?;
        validate_file(&file, "file")?;
        Ok(file)
    }

    /// Deletes a file by ID.
    pub async fn delete_file(&self, file_id: &str) -> Result<(), TaskForceAIError> {
        let path = format!("/files/{}", encode_path_segment(file_id));
        let _: serde_json::Value = self.request(reqwest::Method::DELETE, &path, None).await?;
        Ok(())
    }

    /// Downloads the content of a file.
    pub async fn download_file(&self, file_id: &str) -> Result<Bytes, TaskForceAIError> {
        let url = format!(
            "{}/files/{}/content",
            self.base_url,
            encode_path_segment(file_id)
        );
        let mut response = self.with_sdk_headers(self.client.get(&url)).send().await?;
        let status = response.status();

        if !status.is_success() {
            return Err(
                Self::api_error_from_response(response, "Failed to read error message").await,
            );
        }

        if let Some(content_length) = response.content_length() {
            if content_length > MAX_DOWNLOAD_SIZE_BYTES as u64 {
                return Err(TaskForceAIError::Other(format!(
                    "File too large to download safely ({} bytes > {} bytes)",
                    content_length, MAX_DOWNLOAD_SIZE_BYTES
                )));
            }
        }

        let mut body = BytesMut::new();
        while let Some(chunk) = response.chunk().await? {
            if body.len() + chunk.len() > MAX_DOWNLOAD_SIZE_BYTES {
                return Err(TaskForceAIError::Other(format!(
                    "File too large to download safely (limit: {} bytes)",
                    MAX_DOWNLOAD_SIZE_BYTES
                )));
            }
            body.extend_from_slice(&chunk);
        }

        Ok(body.freeze())
    }
}
