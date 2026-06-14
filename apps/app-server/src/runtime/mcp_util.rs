use std::collections::BTreeSet;

use crate::protocol::{McpServerAddParams, McpServerRecord};

use super::error::RuntimeError;
use super::{KEYCHAIN_AUTH_USER, KEYCHAIN_SERVICE};

pub(crate) fn normalize_metadata_key(key: &str) -> Result<&str, RuntimeError> {
    let key = key.trim();
    match key {
        "auth_token"
        | "device_id"
        | "last_sync_version"
        | "default_model_id"
        | "quick_mode"
        | "goal_state"
        | "active_project_id"
        | "mcp_servers"
        | "orchestration_config"
        | "local_settings" => Ok(key),
        "" => Err(RuntimeError::invalid_params("metadata key is required")),
        _ => Err(RuntimeError::invalid_params("unsupported metadata key")),
    }
}

pub(crate) fn non_empty_string(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

pub(crate) fn keychain_get_auth_token() -> Result<Option<String>, keyring::Error> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_AUTH_USER)?;
    match entry.get_password() {
        Ok(token) => Ok(non_empty_string(&token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(err),
    }
}

pub(crate) fn keychain_set_auth_token(token: &str) -> Result<(), keyring::Error> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_AUTH_USER)?;
    entry.set_password(token)
}

pub(crate) fn keychain_delete_auth_token() -> Result<(), keyring::Error> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_AUTH_USER)?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(err),
    }
}

pub(crate) fn normalize_mcp_server(
    params: McpServerAddParams,
) -> Result<McpServerRecord, RuntimeError> {
    let name = normalize_mcp_name(&params.name)?;
    let endpoint = params.endpoint.trim();
    parse_mcp_endpoint(endpoint)?;
    Ok(McpServerRecord {
        name,
        endpoint: endpoint.to_string(),
        tools: normalize_mcp_tools(params.tools),
        enabled: params.enabled,
    })
}

pub(crate) fn normalize_mcp_name(name: &str) -> Result<String, RuntimeError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(RuntimeError::invalid_params("mcp server name is required"));
    }
    if !name
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        return Err(RuntimeError::invalid_params(
            "mcp server name may only contain letters, numbers, dots, dashes, and underscores",
        ));
    }
    Ok(name.to_string())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct McpEndpointSpec {
    pub(crate) kind: String,
    pub(crate) command: Option<String>,
    pub(crate) args: Vec<String>,
}

pub(crate) fn parse_mcp_endpoint(raw: &str) -> Result<McpEndpointSpec, RuntimeError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(RuntimeError::invalid_params("mcp endpoint is required"));
    }
    if trimmed.starts_with("sse+http://") || trimmed.starts_with("sse+https://") {
        return Ok(McpEndpointSpec {
            kind: "sse".to_string(),
            command: None,
            args: Vec::new(),
        });
    }
    if let Some(rest) = trimmed.strip_prefix("stdio://") {
        return parse_mcp_stdio_url(rest);
    }
    if let Some(rest) = trimmed.strip_prefix("stdio:") {
        return parse_mcp_command(trimmed, rest);
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return Ok(McpEndpointSpec {
            kind: "streamable_http".to_string(),
            command: None,
            args: Vec::new(),
        });
    }
    if trimmed.contains("://") {
        return Err(RuntimeError::invalid_params(
            "unsupported mcp endpoint scheme",
        ));
    }
    parse_mcp_command(trimmed, trimmed)
}

pub(crate) fn parse_mcp_stdio_url(rest: &str) -> Result<McpEndpointSpec, RuntimeError> {
    let (command_part, query) = rest.split_once('?').unwrap_or((rest, ""));
    let command = command_part.trim_matches('/').trim();
    if command.is_empty() {
        return Err(RuntimeError::invalid_params(
            "stdio endpoint is missing a command",
        ));
    }
    let args = query
        .split('&')
        .filter_map(|part| {
            let (key, value) = part.split_once('=')?;
            if key == "arg" {
                let value = percent_decode(value).trim().to_string();
                if value.is_empty() {
                    None
                } else {
                    Some(value)
                }
            } else {
                None
            }
        })
        .collect();
    Ok(McpEndpointSpec {
        kind: "stdio".to_string(),
        command: Some(command.to_string()),
        args,
    })
}

pub(crate) fn parse_mcp_command(
    raw: &str,
    command_line: &str,
) -> Result<McpEndpointSpec, RuntimeError> {
    let parts = split_command_line(command_line).map_err(RuntimeError::invalid_params)?;
    let Some((command, args)) = parts.split_first() else {
        return Err(RuntimeError::invalid_params(
            "mcp endpoint is missing a command",
        ));
    };
    let command = if raw == command_line {
        command.to_string()
    } else {
        command.trim().to_string()
    };
    Ok(McpEndpointSpec {
        kind: "stdio".to_string(),
        command: Some(command),
        args: args.to_vec(),
    })
}

pub(crate) fn split_command_line(input: &str) -> Result<Vec<String>, String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut quote = None;
    let mut escape = false;
    for ch in input.trim().chars() {
        if escape {
            current.push(ch);
            escape = false;
        } else if ch == '\\' {
            escape = true;
        } else if let Some(active_quote) = quote {
            if ch == active_quote {
                quote = None;
            } else {
                current.push(ch);
            }
        } else if ch == '"' || ch == '\'' {
            quote = Some(ch);
        } else if ch.is_whitespace() {
            if !current.is_empty() {
                parts.push(std::mem::take(&mut current));
            }
        } else {
            current.push(ch);
        }
    }
    if escape {
        return Err("unterminated escape sequence in command".to_string());
    }
    if quote.is_some() {
        return Err("unterminated quoted string in command".to_string());
    }
    if !current.is_empty() {
        parts.push(current);
    }
    Ok(parts)
}

pub(crate) fn percent_decode(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(hex) = u8::from_str_radix(&input[index + 1..index + 3], 16) {
                output.push(hex as char);
                index += 3;
                continue;
            }
        }
        output.push(if bytes[index] == b'+' {
            ' '
        } else {
            bytes[index] as char
        });
        index += 1;
    }
    output
}

pub(crate) fn normalize_mcp_tools(tools: Vec<String>) -> Vec<String> {
    let mut unique = BTreeSet::new();
    tools
        .into_iter()
        .filter_map(|tool| {
            let tool = tool.trim();
            if tool.is_empty() || !unique.insert(tool.to_string()) {
                None
            } else {
                Some(tool.to_string())
            }
        })
        .collect()
}
