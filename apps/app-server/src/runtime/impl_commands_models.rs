use crate::ollama::{normalize_base_url, OllamaClient};
use crate::protocol::*;

use super::error::RuntimeError;
use super::models::{format_model_list, local_model_list_result, map_ollama_status};
use super::util::*;

impl super::AppRuntime {
    pub(crate) fn handle_model_command(
        &mut self,
        args: &[&str],
    ) -> Result<CommandExecuteResult, RuntimeError> {
        let current = self
            .default_model_id()?
            .unwrap_or_else(|| "default".to_string());
        let Some(action) = args.first().map(|value| value.to_ascii_lowercase()) else {
            return Ok(command_message(
                "Model",
                format!("Current model: {current}\nUse /model set <model-id>."),
            ));
        };
        match action.as_str() {
            "list" => Ok(command_message(
                "Model",
                format_model_list(&local_model_list_result(self.default_model_id()?)),
            )),
            "reset" | "default" => {
                self.set_metadata_value("default_model_id", "")?;
                Ok(command_message("Model", "Model reset to default."))
            }
            "set" | "select" => {
                let model_id = args.get(1..).unwrap_or_default().join(" ");
                self.set_model_id(&model_id)
            }
            _ => self.set_model_id(&args.join(" ")),
        }
    }

    pub(crate) fn set_model_id(
        &mut self,
        model_id: &str,
    ) -> Result<CommandExecuteResult, RuntimeError> {
        let model_id = model_id.trim();
        if model_id.is_empty() {
            return Ok(command_unhandled("Model", "Usage: /model set <model-id>"));
        }
        self.set_model_metadata(model_id)?;
        Ok(command_message(
            "Model",
            format!("Model set to {model_id}."),
        ))
    }

    pub async fn model_list(&self) -> Result<AppResponse, RuntimeError> {
        Ok(value(self.model_list_result().await?))
    }

    pub async fn model_select(
        &mut self,
        params: ModelSelectParams,
    ) -> Result<AppResponse, RuntimeError> {
        self.set_model_metadata(&params.model_id)?;
        self.model_list().await
    }

    pub async fn model_reset(&mut self) -> Result<AppResponse, RuntimeError> {
        self.set_metadata_value("default_model_id", "")?;
        self.model_list().await
    }

    pub async fn ollama_status(
        &self,
        params: OllamaStatusParams,
    ) -> Result<AppResponse, RuntimeError> {
        let base_url = self.ollama_base_url(params.base_url);
        let client = OllamaClient::new(base_url.clone());
        Ok(value(map_ollama_status(client.status(&base_url).await)))
    }

    pub async fn ollama_ensure(
        &self,
        params: OllamaEnsureParams,
    ) -> Result<AppResponse, RuntimeError> {
        let base_url = self.ollama_base_url(params.base_url);
        let client = OllamaClient::new(base_url.clone());
        let result = client
            .ensure_ready(&base_url, params.model_id.as_deref())
            .await
            .map_err(|err| RuntimeError::network(err.to_string()))?;
        Ok(value(OllamaEnsureResult {
            status: map_ollama_status(result.status),
            model: result.model,
            pulled: result.pulled,
            pull_events: result.pull_events,
        }))
    }

    pub(crate) fn ollama_base_url(&self, override_base_url: Option<String>) -> String {
        override_base_url
            .as_deref()
            .map(normalize_base_url)
            .unwrap_or_else(|| self.config.ollama_base_url.clone())
    }

    pub(crate) async fn model_list_result(&self) -> Result<ModelListResult, RuntimeError> {
        let selected_model_id = self.default_model_id()?;
        if self.config.remote_model_catalog {
            if let Ok(catalog) = self.api_client.list_models().await {
                return Ok(ModelListResult {
                    enabled: catalog.enabled,
                    options: catalog.options,
                    default_model_id: selected_model_id
                        .clone()
                        .unwrap_or(catalog.default_model_id),
                    selected_model_id,
                    remote_catalog: true,
                });
            }
        }
        Ok(local_model_list_result(selected_model_id))
    }

    pub(crate) fn set_model_metadata(&mut self, model_id: &str) -> Result<(), RuntimeError> {
        let model_id = model_id.trim();
        if model_id.is_empty() {
            return Err(RuntimeError::invalid_params("modelId is required"));
        }
        self.set_metadata_value("default_model_id", model_id)
    }
}
