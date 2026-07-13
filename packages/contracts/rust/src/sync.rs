use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{ConversationRecord, MessageRecord};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatusResult {
    pub device_id: Option<String>,
    pub last_sync_version: i64,
    pub configured: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncConfigureParams {
    #[serde(default)]
    pub device_id: Option<String>,
    #[serde(default)]
    pub last_sync_version: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncDeviceResult {
    pub device_id: String,
    pub generated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPullParams {
    #[serde(default)]
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPullResult {
    pub device_id: Option<String>,
    pub latest_version: i64,
    pub conversations: Vec<ConversationRecord>,
    pub messages: Vec<MessageRecord>,
    pub deletions: Vec<Value>,
    #[serde(default)]
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPushParams {
    #[serde(default)]
    pub conversations: Vec<ConversationRecord>,
    #[serde(default)]
    pub messages: Vec<MessageRecord>,
    #[serde(default)]
    pub deletions: Vec<Value>,
    #[serde(default)]
    pub new_version: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPushResult {
    pub accepted: Vec<String>,
    pub conflicts: Vec<Value>,
    pub new_version: i64,
    #[serde(default)]
    pub conversation_id_mappings: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSyncPullParams {
    pub device_id: String,
    pub last_sync_version: i64,
    #[serde(default)]
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DesktopSyncPullResult {
    pub conversations: Vec<Value>,
    pub messages: Vec<Value>,
    pub deletions: Vec<Value>,
    pub latest_version: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_more: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSyncPushParams {
    #[serde(default)]
    pub conversations: Vec<Value>,
    #[serde(default)]
    pub messages: Vec<Value>,
    #[serde(default)]
    pub deletions: Vec<Value>,
    pub device_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DesktopSyncPushResult {
    pub accepted: Vec<String>,
    pub conflicts: Vec<Value>,
    pub new_version: i64,
    pub conversation_id_mappings: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncRealtimePollParams {
    #[serde(default)]
    pub last_event_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncRealtimePollResult {
    pub has_updates: bool,
    pub last_event_id: String,
}
