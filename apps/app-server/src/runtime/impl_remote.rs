use crate::protocol::*;

use super::error::RuntimeError;
use super::util::*;

const REMOTE_ALLOW_CONNECTIONS_KEY: &str = "remote_allow_connections";
const REMOTE_KEEP_AWAKE_KEY: &str = "remote_keep_awake";

impl super::AppRuntime {
    pub fn remote_settings_get(&mut self) -> Result<AppResponse, RuntimeError> {
        Ok(value(self.remote_settings_result()?))
    }

    pub async fn remote_settings_update(
        &mut self,
        params: RemoteSettingsUpdateParams,
    ) -> Result<AppResponse, RuntimeError> {
        let current = self.remote_settings_result()?;
        let allow_connections = params
            .allow_connections
            .unwrap_or(current.allow_connections);
        let keep_awake = params.keep_awake.unwrap_or(current.keep_awake);

        if let Some(token) = self.auth_token()? {
            self.api_client
                .remote_upsert_target(
                    &token,
                    &current.device_id,
                    &current.device_name,
                    allow_connections,
                    keep_awake,
                )
                .await?;
        }

        self.set_metadata_value(REMOTE_ALLOW_CONNECTIONS_KEY, bool_value(allow_connections))?;
        self.set_metadata_value(REMOTE_KEEP_AWAKE_KEY, bool_value(keep_awake))?;
        Ok(value(RemoteSettingsResult {
            allow_connections,
            keep_awake,
            ..current
        }))
    }

    pub async fn remote_pairing_code_create(&mut self) -> Result<AppResponse, RuntimeError> {
        let settings = self.remote_settings_result()?;
        if !settings.allow_connections {
            return Err(RuntimeError::invalid_params(
                "Enable Remote connections before adding a device",
            ));
        }
        let token = self
            .auth_token()?
            .ok_or_else(|| RuntimeError::invalid_params("Sign in to add a Remote device"))?;
        self.api_client
            .remote_upsert_target(
                &token,
                &settings.device_id,
                &settings.device_name,
                settings.allow_connections,
                settings.keep_awake,
            )
            .await?;
        let code = self
            .api_client
            .remote_create_pairing_code(&token, &settings.device_id, &settings.device_name)
            .await?;
        Ok(value(RemotePairingCodeResult {
            code: code.code,
            expires_in: code.expires_in,
        }))
    }

    pub async fn remote_controller_list(&mut self) -> Result<AppResponse, RuntimeError> {
        let settings = self.remote_settings_result()?;
        let token = self
            .auth_token()?
            .ok_or_else(|| RuntimeError::invalid_params("Sign in to manage Remote devices"))?;
        let result = self
            .api_client
            .remote_list_controllers(&token, &settings.device_id)
            .await?;
        Ok(value(RemoteControllerListResult {
            devices: result
                .devices
                .into_iter()
                .map(|device| RemoteControllerRecord {
                    device_id: device.device_id,
                    device_name: device.device_name,
                    user_agent: device.user_agent,
                    last_connected_at: device.last_connected_at,
                    capabilities: device.capabilities,
                })
                .collect(),
        }))
    }

    pub async fn remote_controller_revoke(
        &mut self,
        params: RemoteControllerRevokeParams,
    ) -> Result<AppResponse, RuntimeError> {
        let settings = self.remote_settings_result()?;
        let token = self
            .auth_token()?
            .ok_or_else(|| RuntimeError::invalid_params("Sign in to manage Remote devices"))?;
        self.api_client
            .remote_revoke_controller(&token, &settings.device_id, params.device_id.trim())
            .await?;
        Ok(value(AckResult { ok: true }))
    }

    pub(crate) fn remote_enabled(&self) -> Result<bool, RuntimeError> {
        Ok(metadata_bool(
            self.metadata_value(REMOTE_ALLOW_CONNECTIONS_KEY)?,
        ))
    }

    pub(crate) fn remote_disable_on_logout(&mut self) -> Result<(), RuntimeError> {
        self.set_metadata_value(REMOTE_ALLOW_CONNECTIONS_KEY, bool_value(false))
    }

    pub(crate) fn remote_identity(&mut self) -> Result<(String, String), RuntimeError> {
        let device = self.sync_ensure_device_result()?;
        Ok((device.device_id, local_device_name()))
    }

    pub(crate) fn remote_last_command_id(&self) -> Result<String, RuntimeError> {
        Ok(self
            .metadata_value("remote_last_command_id")?
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "0".to_string()))
    }

    pub(crate) fn set_remote_last_command_id(&mut self, value: &str) -> Result<(), RuntimeError> {
        self.set_metadata_value("remote_last_command_id", value)
    }

    pub(crate) fn remote_token(&self) -> Result<Option<String>, RuntimeError> {
        self.auth_token()
    }

    pub(crate) fn remote_api_client(&self) -> &crate::api::ApiClient {
        &self.api_client
    }

    fn remote_settings_result(&mut self) -> Result<RemoteSettingsResult, RuntimeError> {
        let (device_id, device_name) = self.remote_identity()?;
        Ok(RemoteSettingsResult {
            device_id,
            device_name,
            allow_connections: metadata_bool(self.metadata_value(REMOTE_ALLOW_CONNECTIONS_KEY)?),
            keep_awake: metadata_bool(self.metadata_value(REMOTE_KEEP_AWAKE_KEY)?),
        })
    }
}

fn bool_value(value: bool) -> &'static str {
    if value {
        "true"
    } else {
        "false"
    }
}

fn metadata_bool(value: Option<String>) -> bool {
    value.as_deref() == Some("true")
}

fn local_device_name() -> String {
    std::env::var("TASKFORCEAI_DEVICE_NAME")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            std::env::var("HOSTNAME")
                .ok()
                .filter(|value| !value.trim().is_empty())
        })
        .unwrap_or_else(|| "This Mac".to_string())
}
