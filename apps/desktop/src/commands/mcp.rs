use serde_json::{Map, Value};
use tracing::{error, info};

use crate::{
    mcp::{parse_endpoint_spec, DesktopMcpServerConfig, DesktopMcpServerSnapshot},
    state::AppState,
};

fn normalize_tool_arguments(arguments: Option<Value>) -> Result<Map<String, Value>, String> {
    match arguments {
        None | Some(Value::Null) => Ok(Map::new()),
        Some(Value::Object(map)) => Ok(map),
        Some(_) => Err("MCP tool arguments must be a JSON object".to_string()),
    }
}

fn validate_renderer_server_config(server: &DesktopMcpServerConfig) -> Result<(), String> {
    reject_local_computer_use_server(server)?;
    parse_endpoint_spec(&server.endpoint)
        .map(|_| ())
        .map_err(|err| err.to_string())
}

fn reject_local_computer_use_server(server: &DesktopMcpServerConfig) -> Result<(), String> {
    if server
        .name
        .trim()
        .eq_ignore_ascii_case("local-computer-use")
        && server
            .endpoint
            .trim()
            .eq_ignore_ascii_case("taskforceai:local-computer-use")
    {
        return Err("local Computer Use requires an authorized desktop capability".to_string());
    }
    Ok(())
}

#[tauri::command]
#[tracing::instrument(skip(state), err)]
pub async fn mcp_discover(
    state: tauri::State<'_, AppState>,
    server: DesktopMcpServerConfig,
) -> Result<DesktopMcpServerSnapshot, String> {
    validate_renderer_server_config(&server)?;
    info!(target: "mcp", server = %server.name, endpoint = %server.endpoint, "Inspecting MCP server");
    metrics::counter!("mcp.command", "name" => "discover").increment(1);
    state.mcp.discover(server).await.map_err(|err| {
        error!(target: "mcp", error = %err, "MCP inspect failed");
        err.to_string()
    })
}

#[tauri::command]
#[tracing::instrument(skip(state, arguments), err)]
pub async fn mcp_call_tool(
    state: tauri::State<'_, AppState>,
    server: DesktopMcpServerConfig,
    name: String,
    arguments: Option<Value>,
) -> Result<Value, String> {
    validate_renderer_server_config(&server)?;
    let normalized_arguments = normalize_tool_arguments(arguments)?;
    info!(target: "mcp", server = %server.name, tool = %name, "Calling MCP tool");
    metrics::counter!("mcp.command", "name" => "call_tool").increment(1);
    let result = state
        .mcp
        .call_tool(server, name, normalized_arguments)
        .await
        .map_err(|err| {
            error!(target: "mcp", error = %err, "MCP tool call failed");
            err.to_string()
        })?;

    serde_json::to_value(result).map_err(|err| err.to_string())
}

#[tauri::command]
#[tracing::instrument(skip(state), err)]
pub async fn mcp_close(
    state: tauri::State<'_, AppState>,
    server_name: String,
) -> Result<(), String> {
    info!(target: "mcp", server = %server_name, "Closing MCP session");
    metrics::counter!("mcp.command", "name" => "close").increment(1);
    state.mcp.close(&server_name).await.map_err(|err| {
        error!(target: "mcp", error = %err, "MCP session close failed");
        err.to_string()
    })
}

#[tauri::command]
#[tracing::instrument(skip(state), err)]
pub async fn mcp_close_all(state: tauri::State<'_, AppState>) -> Result<(), String> {
    info!(target: "mcp", "Closing all MCP sessions");
    metrics::counter!("mcp.command", "name" => "close_all").increment(1);
    state.mcp.close_all().await.map_err(|err| {
        error!(target: "mcp", error = %err, "MCP close-all failed");
        err.to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::{normalize_tool_arguments, validate_renderer_server_config};
    use crate::mcp::DesktopMcpServerConfig;
    use serde_json::json;

    #[test]
    fn normalize_tool_arguments_accepts_object_and_null() {
        let empty = normalize_tool_arguments(None).expect("none should be empty");
        assert!(empty.is_empty());

        let object = normalize_tool_arguments(Some(json!({"value": 1}))).expect("object arguments");
        assert_eq!(
            object.get("value").and_then(|value| value.as_i64()),
            Some(1)
        );
    }

    #[test]
    fn normalize_tool_arguments_rejects_non_object_values() {
        let err = normalize_tool_arguments(Some(json!(["bad"]))).expect_err("array should fail");
        assert_eq!(err, "MCP tool arguments must be a JSON object");
    }

    #[test]
    fn validate_renderer_server_config_allows_supported_endpoints() {
        let server = DesktopMcpServerConfig {
            name: "local-computer-use".to_string(),
            endpoint: "taskforceai:local-computer-use".to_string(),
            enabled: true,
        };
        let error = validate_renderer_server_config(&server)
            .expect_err("built-in local computer server should be rejected");
        assert_eq!(
            error,
            "local Computer Use requires an authorized desktop capability"
        );

        let server = DesktopMcpServerConfig {
            name: "remote".to_string(),
            endpoint: "https://example.com/mcp".to_string(),
            enabled: true,
        };
        validate_renderer_server_config(&server).expect("http endpoint should be valid");

        let server = DesktopMcpServerConfig {
            name: "local".to_string(),
            endpoint: "stdio:npx @modelcontextprotocol/server-filesystem".to_string(),
            enabled: true,
        };
        validate_renderer_server_config(&server).expect("stdio endpoint should be valid");
    }

    #[test]
    fn validate_renderer_server_config_rejects_unsupported_endpoints() {
        let server = DesktopMcpServerConfig {
            name: "local".to_string(),
            endpoint: "ftp://example.com/mcp".to_string(),
            enabled: true,
        };
        let error = validate_renderer_server_config(&server).expect_err("ftp should be invalid");
        assert_eq!(error, "unsupported MCP endpoint scheme ftp");
    }
}
