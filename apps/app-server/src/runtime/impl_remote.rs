use crate::protocol::*;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use rand::RngCore as _;

use super::error::RuntimeError;
use super::mcp_util::{keychain_get_secret, keychain_set_secret};
use super::util::*;
use super::AuthTokenStorage;
use crate::api::ApiClientError;

const REMOTE_ALLOW_CONNECTIONS_KEY: &str = "remote_allow_connections";
const REMOTE_KEEP_AWAKE_KEY: &str = "remote_keep_awake";
const REMOTE_DEVICE_CREDENTIAL_KEY: &str = "remote_device_credential";
const REMOTE_DEVICE_ID_KEY: &str = "remote_device_id";

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
        let mut next = RemoteSettingsResult {
            allow_connections,
            keep_awake,
            ..current
        };

        if let Some(token) = self.auth_token()? {
            let device_credential = self.remote_device_credential()?;
            next = self
                .upsert_remote_target_with_recovery(&token, &device_credential, next)
                .await?;
        }

        self.set_metadata_value(REMOTE_ALLOW_CONNECTIONS_KEY, bool_value(allow_connections))?;
        self.set_metadata_value(REMOTE_KEEP_AWAKE_KEY, bool_value(keep_awake))?;
        Ok(value(next))
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
        let device_credential = self.remote_device_credential()?;
        let settings = self
            .upsert_remote_target_with_recovery(&token, &device_credential, settings)
            .await?;
        let result = self
            .api_client
            .remote_create_pairing_code(
                &token,
                &settings.device_id,
                &device_credential,
                &settings.device_name,
            )
            .await;
        let code = self.resolve_remote_api_result(result)?;
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
        let device_credential = self.remote_device_credential()?;
        let settings = self
            .upsert_remote_target_with_recovery(&token, &device_credential, settings)
            .await?;
        let result = self
            .api_client
            .remote_list_controllers(&token, &settings.device_id, &device_credential)
            .await;
        let result = self.resolve_remote_api_result(result)?;
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
        let device_credential = self.remote_device_credential()?;
        let result = self
            .api_client
            .remote_revoke_controller(
                &token,
                &settings.device_id,
                &device_credential,
                params.device_id.trim(),
            )
            .await;
        self.resolve_remote_api_result(result)?;
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
        if let Some(device_id) = self
            .metadata_value(REMOTE_DEVICE_ID_KEY)?
            .filter(|value| !value.trim().is_empty())
        {
            return Ok((device_id, local_device_name()));
        }
        let device = self.sync_ensure_device_result()?;
        Ok((device.device_id, local_device_name()))
    }

    fn rotate_remote_identity(&mut self) -> Result<(String, String), RuntimeError> {
        let mut bytes = [0_u8; 16];
        rand::rng().fill_bytes(&mut bytes);
        let device_id = format!("taskforce-remote-{}", URL_SAFE_NO_PAD.encode(bytes));
        self.set_metadata_value(REMOTE_DEVICE_ID_KEY, &device_id)?;
        Ok((device_id, local_device_name()))
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

    pub(crate) fn remote_device_credential(&mut self) -> Result<String, RuntimeError> {
        if self.config.auth_token_storage == AuthTokenStorage::KeyringWithMemoryFallback {
            return self.remote_device_keychain_credential();
        }
        if let Some(credential) = self
            .metadata_value(REMOTE_DEVICE_CREDENTIAL_KEY)?
            .filter(|value| (43..=128).contains(&value.len()))
        {
            return Ok(credential);
        }

        let mut bytes = [0_u8; 32];
        rand::rng().fill_bytes(&mut bytes);
        let credential = URL_SAFE_NO_PAD.encode(bytes);
        self.set_metadata_value(REMOTE_DEVICE_CREDENTIAL_KEY, &credential)?;
        Ok(credential)
    }

    fn remote_device_keychain_credential(&self) -> Result<String, RuntimeError> {
        if let Some(credential) = remote_keychain_get(&self.config)
            .map_err(|error| {
                RuntimeError::storage(format!("Remote credential keychain read failed: {error}"))
            })?
            .filter(|value| (43..=128).contains(&value.len()))
        {
            return Ok(credential);
        }

        let mut bytes = [0_u8; 32];
        rand::rng().fill_bytes(&mut bytes);
        let credential = URL_SAFE_NO_PAD.encode(bytes);
        remote_keychain_set(&self.config, &credential).map_err(|error| {
            RuntimeError::storage(format!("Remote credential keychain write failed: {error}"))
        })?;
        Ok(credential)
    }

    pub(crate) fn remote_api_client(&self) -> &crate::api::ApiClient {
        &self.api_client
    }

    async fn upsert_remote_target_with_recovery(
        &mut self,
        token: &str,
        device_credential: &str,
        mut settings: RemoteSettingsResult,
    ) -> Result<RemoteSettingsResult, RuntimeError> {
        let result = self
            .api_client
            .remote_upsert_target(
                token,
                &settings.device_id,
                device_credential,
                &settings.device_name,
                settings.allow_connections,
                settings.keep_awake,
            )
            .await;
        if result.as_ref().is_err_and(ApiClientError::is_forbidden) {
            let (device_id, device_name) = self.rotate_remote_identity()?;
            settings.device_id = device_id;
            settings.device_name = device_name;
            let retry = self
                .api_client
                .remote_upsert_target(
                    token,
                    &settings.device_id,
                    device_credential,
                    &settings.device_name,
                    settings.allow_connections,
                    settings.keep_awake,
                )
                .await;
            self.resolve_remote_api_result(retry)?;
            return Ok(settings);
        }
        self.resolve_remote_api_result(result)?;
        Ok(settings)
    }

    fn resolve_remote_api_result<T>(
        &mut self,
        result: Result<T, ApiClientError>,
    ) -> Result<T, RuntimeError> {
        match result {
            Ok(value) => Ok(value),
            Err(error) if error.is_unauthorized() => {
                self.set_auth_token(None)?;
                Err(RuntimeError::not_configured(
                    "Your session expired. Sign in again.",
                ))
            }
            Err(error) => Err(error.into()),
        }
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
    resolve_local_device_name(
        std::env::var("TASKFORCEAI_DEVICE_NAME").ok(),
        std::env::var("HOSTNAME").ok(),
    )
}

pub(super) fn resolve_local_device_name(
    configured_name: Option<String>,
    hostname: Option<String>,
) -> String {
    configured_name
        .filter(|value| !value.trim().is_empty())
        .or_else(|| hostname.filter(|value| !value.trim().is_empty()))
        .unwrap_or_else(|| "This Mac".to_string())
}

fn remote_keychain_get(config: &super::RuntimeConfig) -> Result<Option<String>, String> {
    #[cfg(test)]
    if let Some(keychain) = &config.auth_keychain {
        return keychain.get(&config.auth_keychain_service);
    }

    // coverage:ignore-start
    keychain_get_secret(&config.auth_keychain_service, REMOTE_DEVICE_CREDENTIAL_KEY)
        .map_err(|error| error.to_string())
    // coverage:ignore-end
}

fn remote_keychain_set(config: &super::RuntimeConfig, credential: &str) -> Result<(), String> {
    #[cfg(test)]
    if let Some(keychain) = &config.auth_keychain {
        return keychain.set(&config.auth_keychain_service, credential);
    }

    // coverage:ignore-start
    keychain_set_secret(
        &config.auth_keychain_service,
        REMOTE_DEVICE_CREDENTIAL_KEY,
        credential,
    )
    .map_err(|error| error.to_string())
    // coverage:ignore-end
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remote_api_result_preserves_non_authentication_errors() {
        let mut runtime = super::super::AppRuntime::new(super::super::RuntimeConfig::default());
        let error = runtime
            .resolve_remote_api_result::<()>(Err(ApiClientError::Status { status: 503 }))
            .expect_err("service errors should propagate");
        assert!(error.to_string().contains("503"));
    }
}
