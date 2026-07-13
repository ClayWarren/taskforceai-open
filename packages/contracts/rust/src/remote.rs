use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSettingsResult {
    pub device_id: String,
    pub device_name: String,
    pub allow_connections: bool,
    pub keep_awake: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSettingsUpdateParams {
    #[serde(default)]
    pub allow_connections: Option<bool>,
    #[serde(default)]
    pub keep_awake: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemotePairingCodeResult {
    pub code: String,
    pub expires_in: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteControllerRecord {
    pub device_id: String,
    pub device_name: String,
    pub user_agent: String,
    pub last_connected_at: String,
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteControllerListResult {
    pub devices: Vec<RemoteControllerRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteControllerRevokeParams {
    pub device_id: String,
}
