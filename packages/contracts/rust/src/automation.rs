use serde::{Deserialize, Serialize};

use crate::defaults::default_true;
use crate::{AgentSessionRecord, RunRecord};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelAddParams {
    pub name: String,
    #[serde(default = "default_channel_kind")]
    pub kind: String,
    #[serde(default)]
    pub target_session_id: Option<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelIDParams {
    pub channel_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelPushParams {
    pub channel_id: String,
    pub message: String,
    #[serde(default)]
    pub dispatch: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelRecord {
    pub channel_id: String,
    pub name: String,
    pub kind: String,
    pub enabled: bool,
    #[serde(default)]
    pub target_session_id: Option<String>,
    #[serde(default)]
    pub last_message: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelListResult {
    pub channels: Vec<ChannelRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelResult {
    pub channel: ChannelRecord,
    #[serde(default)]
    pub session: Option<AgentSessionRecord>,
    #[serde(default)]
    pub run: Option<RunRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleAddParams {
    pub name: String,
    pub prompt: String,
    pub cadence: String,
    #[serde(default)]
    pub target_session_id: Option<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleIDParams {
    pub schedule_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleTickParams {
    #[serde(default)]
    pub now: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleRecord {
    pub schedule_id: String,
    pub name: String,
    pub prompt: String,
    pub cadence: String,
    pub enabled: bool,
    #[serde(default)]
    pub target_session_id: Option<String>,
    #[serde(default)]
    pub next_run_at: Option<u64>,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleListResult {
    pub schedules: Vec<ScheduleRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleResult {
    pub schedule: ScheduleRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleDispatchRecord {
    pub schedule_id: String,
    pub name: String,
    pub run: RunRecord,
    #[serde(default)]
    pub session: Option<AgentSessionRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleTickResult {
    pub dispatched: Vec<ScheduleDispatchRecord>,
    #[serde(default)]
    pub next_due_at: Option<u64>,
}

fn default_channel_kind() -> String {
    "local".to_string()
}
