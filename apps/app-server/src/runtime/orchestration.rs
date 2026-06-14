use std::collections::BTreeMap;

use serde_json::json;

use crate::api::{ApiSubmitMcpServer, ApiSubmitMcpTool};
use crate::ollama::OllamaClient;
use crate::protocol::{
    ClientMcpTool, McpServerRecord, OrchestrationConfig, OrchestrationRole, RunRecord,
};

use super::error::RuntimeError;
use super::models::{
    is_ollama_model_id, ollama_memory_recommendation, ollama_model_name, total_system_memory_bytes,
};
use super::settings_util::orchestration_role_order;
use super::HYBRID_ROLE;

pub(crate) fn default_orchestration_config() -> OrchestrationConfig {
    OrchestrationConfig {
        roles: default_orchestration_roles(),
        budget: None,
    }
}

pub(crate) fn orchestration_role_models(config: &OrchestrationConfig) -> BTreeMap<String, String> {
    config
        .roles
        .iter()
        .filter_map(|role| {
            let model_id = role.model_id.as_deref()?.trim();
            if model_id.is_empty() {
                None
            } else {
                Some((role.name.clone(), model_id.to_string()))
            }
        })
        .collect()
}

pub(crate) fn remote_orchestration_role_models(
    config: &OrchestrationConfig,
) -> BTreeMap<String, String> {
    orchestration_role_models(config)
        .into_iter()
        .filter(|(_, model_id)| !is_ollama_model_id(model_id))
        .collect()
}

#[derive(Clone, Debug)]
pub(crate) struct HybridLocalReviewer {
    pub(crate) role: String,
    pub(crate) model_id: String,
    pub(crate) base_url: String,
}

pub(crate) fn hybrid_local_reviewer(
    config: &OrchestrationConfig,
    base_url: &str,
) -> Option<HybridLocalReviewer> {
    let role = config
        .roles
        .iter()
        .find(|role| role.model_id.as_deref().is_some_and(is_ollama_model_id))?;
    Some(HybridLocalReviewer {
        role: role.name.clone(),
        model_id: role.model_id.clone()?,
        base_url: base_url.to_string(),
    })
}

pub(crate) async fn run_hybrid_local_review(
    reviewer: HybridLocalReviewer,
    prompt: String,
) -> Result<(HybridLocalReviewer, String), String> {
    let model = ollama_model_name(Some(&reviewer.model_id));
    let client = OllamaClient::new(reviewer.base_url.clone());
    let review_prompt = format!(
        "You are TaskForceAI's local {role} reviewer running alongside a cloud model. \
Review the user's request from first principles. Return a concise critique with risks, \
missed constraints, and one concrete improvement. Do not answer the task directly.\n\nUser request:\n{prompt}",
        role = reviewer.role,
    );
    client
        .ensure_ready(&reviewer.base_url, Some(&model))
        .await
        .map_err(|err| err.to_string())?;
    let output = client
        .create_response(&model, &review_prompt)
        .await
        .map_err(|err| err.to_string())?;
    Ok((reviewer, output))
}

pub(crate) fn apply_hybrid_local_review(
    mut run: RunRecord,
    result: Result<(HybridLocalReviewer, String), String>,
) -> RunRecord {
    match result {
        Ok((reviewer, review)) => {
            let label = format!("Local reviewer ({})", reviewer.model_id);
            run.tool_events.push(json!({
                "toolName": "hybrid.localReviewer",
                "success": true,
                "output": review,
                "metadata": {
                    "role": reviewer.role,
                    "modelId": reviewer.model_id,
                },
            }));
            run.agent_statuses.push(json!({
                "agent": reviewer.role,
                "status": "COMPLETED",
                "modelId": reviewer.model_id,
            }));
            if !review.trim().is_empty() {
                let output = run.output.get_or_insert_with(String::new);
                if !output.trim().is_empty() {
                    output.push_str("\n\n---\n");
                }
                output.push_str(&label);
                output.push_str(":\n");
                output.push_str(review.trim());
            }
        }
        Err(error) => {
            run.tool_events.push(json!({
                "toolName": "hybrid.localReviewer",
                "success": false,
                "error": error,
            }));
        }
    }
    run
}

pub(crate) fn set_orchestration_role_model(
    config: &mut OrchestrationConfig,
    role: &str,
    model_id: Option<String>,
) {
    if let Some(item) = config.roles.iter_mut().find(|item| item.name == role) {
        item.model_id = model_id;
    }
}

pub(crate) fn clear_ollama_orchestration_roles(config: &mut OrchestrationConfig) {
    for role in &mut config.roles {
        if role.model_id.as_deref().is_some_and(is_ollama_model_id) {
            role.model_id = None;
        }
    }
}

pub(crate) fn hybrid_role_name(config: &OrchestrationConfig) -> String {
    config
        .roles
        .iter()
        .find(|role| role.model_id.as_deref().is_some_and(is_ollama_model_id))
        .map(|role| role.name.clone())
        .unwrap_or_else(|| HYBRID_ROLE.to_string())
}

pub(crate) fn recommended_ollama_model_id() -> String {
    ollama_memory_recommendation(total_system_memory_bytes()).recommended_model_id
}

pub(crate) fn api_submit_mcp_server(server: &McpServerRecord) -> ApiSubmitMcpServer {
    ApiSubmitMcpServer {
        name: server.name.clone(),
        tools: server.tools.clone(),
        enabled: server.enabled,
    }
}

pub(crate) fn api_submit_mcp_tool(tool: ClientMcpTool) -> ApiSubmitMcpTool {
    ApiSubmitMcpTool {
        server_name: tool.server_name,
        tool_name: tool.tool_name,
        title: tool.title,
        description: tool.description,
    }
}

pub(crate) fn default_orchestration_roles() -> Vec<OrchestrationRole> {
    [
        ("Researcher", "Web search and fact gathering"),
        ("Analyst", "Data analysis and logic"),
        ("Skeptic", "Critique and risk assessment"),
        ("Pragmatist", "Practical application"),
    ]
    .into_iter()
    .map(|(name, description)| OrchestrationRole {
        name: name.to_string(),
        description: description.to_string(),
        model_id: None,
    })
    .collect()
}

pub(crate) fn merge_default_orchestration_roles(config: &mut OrchestrationConfig) {
    for default_role in default_orchestration_roles() {
        if !config
            .roles
            .iter()
            .any(|role| role.name == default_role.name)
        {
            config.roles.push(default_role);
        }
    }
    config.roles.sort_by(|left, right| {
        orchestration_role_order(&left.name).cmp(&orchestration_role_order(&right.name))
    });
}

pub(crate) fn normalize_orchestration_role(role: &str) -> Result<String, RuntimeError> {
    let role = role.trim();
    default_orchestration_roles()
        .into_iter()
        .find(|candidate| candidate.name.eq_ignore_ascii_case(role))
        .map(|candidate| candidate.name)
        .ok_or_else(|| RuntimeError::invalid_params("invalid orchestration role"))
}
