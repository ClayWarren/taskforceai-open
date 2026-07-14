use serde::{Deserialize, Serialize};

use crate::RunRecord;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelOptionRecord {
    pub id: String,
    pub label: String,
    pub badge: String,
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage_multiple: Option<f64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub reasoning_effort_levels: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_reasoning_effort: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelListResult {
    pub enabled: bool,
    pub options: Vec<ModelOptionRecord>,
    pub default_model_id: String,
    pub selected_model_id: Option<String>,
    pub remote_catalog: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaStatusParams {
    #[serde(default)]
    pub base_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaEnsureParams {
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub model_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaStatusResult {
    pub provider_id: String,
    pub base_url: String,
    pub host_root: String,
    pub connected: bool,
    pub openai_compatible: bool,
    pub responses_supported: Option<bool>,
    pub version: Option<String>,
    pub models: Vec<String>,
    pub default_model: String,
    pub memory: OllamaMemoryRecommendation,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaMemoryRecommendation {
    pub total_bytes: Option<u64>,
    pub total_label: String,
    pub recommended_model_id: String,
    pub recommended_model: String,
    pub minimum_bytes: u64,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum OllamaPullEventRecord {
    Status {
        message: String,
    },
    Progress {
        digest: Option<String>,
        completed: Option<u64>,
        total: Option<u64>,
    },
    Success,
    Error {
        message: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaEnsureResult {
    pub status: OllamaStatusResult,
    pub model: String,
    pub pulled: bool,
    pub pull_events: Vec<OllamaPullEventRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiHealthResult {
    pub healthy: bool,
    pub status: u16,
    pub base_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitRunResult {
    pub run: RunRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunStatusResult {
    pub run: RunRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AckResult {
    pub ok: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandExecuteResult {
    pub handled: bool,
    pub title: String,
    pub message: String,
}
