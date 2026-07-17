use std::collections::BTreeSet;

use crate::protocol::{McpServerAddParams, McpServerRecord};

use super::error::RuntimeError;
use super::KEYCHAIN_AUTH_USER;

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
        | "local_settings"
        | "tui_orchestration_agent_count"
        | "tui_prompt_history" => Ok(key),
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

// coverage:ignore-start -- platform Keychain I/O is exercised by desktop integration tests.
pub(crate) fn keychain_get_auth_token(service: &str) -> Result<Option<String>, keyring::Error> {
    keychain_get_secret(service, KEYCHAIN_AUTH_USER)
}
pub(crate) fn keychain_get_secret(
    service: &str,
    user: &str,
) -> Result<Option<String>, keyring::Error> {
    let entry = keyring::Entry::new(service, user)?;
    match entry.get_password() {
        Ok(token) => Ok(non_empty_string(&token)), // coverage:ignore-line
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(err), // coverage:ignore-line
    }
}
// coverage:ignore-end

// coverage:ignore-start
pub(crate) fn keychain_set_auth_token(service: &str, token: &str) -> Result<(), keyring::Error> {
    keychain_set_secret(service, KEYCHAIN_AUTH_USER, token)
}

pub(crate) fn keychain_set_secret(
    service: &str,
    user: &str,
    secret: &str,
) -> Result<(), keyring::Error> {
    let entry = keyring::Entry::new(service, user)?;
    entry.set_password(secret)
}
// coverage:ignore-end

// coverage:ignore-start
pub(crate) fn keychain_delete_auth_token(service: &str) -> Result<(), keyring::Error> {
    keychain_delete_secret(service, KEYCHAIN_AUTH_USER)
}

pub(crate) fn keychain_delete_secret(service: &str, user: &str) -> Result<(), keyring::Error> {
    let entry = keyring::Entry::new(service, user)?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(err),
        // coverage:ignore-end
    }
} // coverage:ignore-line

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
    let mut output = Vec::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(hex) = u8::from_str_radix(&input[index + 1..index + 3], 16) {
                output.push(hex);
                index += 3;
                continue;
            }
        }
        output.push(if bytes[index] == b'+' {
            b' '
        } else {
            bytes[index]
        });
        index += 1;
    }
    String::from_utf8_lossy(&output).into_owned()
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metadata_string_and_name_normalizers_cover_valid_and_invalid_values() {
        assert_eq!(
            normalize_metadata_key(" auth_token ").unwrap(),
            "auth_token"
        );
        assert_eq!(
            normalize_metadata_key("local_settings").unwrap(),
            "local_settings"
        );
        assert_eq!(
            normalize_metadata_key("tui_prompt_history").unwrap(),
            "tui_prompt_history"
        );
        assert_eq!(
            normalize_metadata_key("tui_orchestration_agent_count").unwrap(),
            "tui_orchestration_agent_count"
        );
        assert!(normalize_metadata_key(" ").is_err());
        assert!(normalize_metadata_key("unsupported").is_err());

        assert_eq!(non_empty_string("  value  ").as_deref(), Some("value"));
        assert_eq!(non_empty_string("   "), None);

        assert_eq!(
            normalize_mcp_name(" files.server-1 ").unwrap(),
            "files.server-1"
        );
        assert!(normalize_mcp_name("").is_err());
        assert!(normalize_mcp_name("bad name").is_err());
    }

    #[test]
    fn mcp_endpoint_parser_covers_http_sse_stdio_url_and_command_forms() {
        let sse = parse_mcp_endpoint("sse+https://example.com/mcp").unwrap();
        assert_eq!(sse.kind, "sse");
        assert_eq!(sse.command, None);

        let http = parse_mcp_endpoint("https://example.com/mcp").unwrap();
        assert_eq!(http.kind, "streamable_http");

        let stdio_url = parse_mcp_endpoint("stdio://npx?arg=-y&arg=%40scope%2Fserver&skip=x&arg=+")
            .expect("stdio URL should parse");
        assert_eq!(stdio_url.kind, "stdio");
        assert_eq!(stdio_url.command.as_deref(), Some("npx"));
        assert_eq!(
            stdio_url.args,
            vec!["-y".to_string(), "@scope/server".to_string()]
        );

        let prefixed = parse_mcp_endpoint("stdio:npx -y \"@scope/server\"").unwrap();
        assert_eq!(prefixed.command.as_deref(), Some("npx"));
        assert_eq!(
            prefixed.args,
            vec!["-y".to_string(), "@scope/server".to_string()]
        );

        let bare = parse_mcp_endpoint("python -m server --flag").unwrap();
        assert_eq!(bare.command.as_deref(), Some("python"));
        assert_eq!(
            bare.args,
            vec!["-m".to_string(), "server".to_string(), "--flag".to_string()]
        );

        assert!(parse_mcp_endpoint("").is_err());
        assert!(parse_mcp_endpoint("ftp://example.com").is_err());
        assert!(parse_mcp_endpoint("stdio://").is_err());
        assert!(parse_mcp_endpoint("stdio:").is_err());
    }

    #[test]
    fn command_line_and_percent_decoding_helpers_cover_quotes_escapes_and_errors() {
        assert_eq!(
            split_command_line(r#"cmd "two words" 'single quoted' escaped\ value"#).unwrap(),
            vec![
                "cmd".to_string(),
                "two words".to_string(),
                "single quoted".to_string(),
                "escaped value".to_string()
            ]
        );
        assert_eq!(split_command_line("   ").unwrap(), Vec::<String>::new());
        assert!(split_command_line("cmd \\").unwrap_err().contains("escape"));
        assert!(split_command_line("cmd \"unterminated")
            .unwrap_err()
            .contains("quoted"));

        assert_eq!(
            percent_decode("hello+world%21%2Fbad%xx"),
            "hello world!/bad%xx"
        );
        assert_eq!(percent_decode("caf%C3%A9+東京"), "café 東京");
        assert_eq!(
            normalize_mcp_tools(vec![
                " read ".to_string(),
                "".to_string(),
                "read".to_string(),
                "write".to_string(),
            ]),
            vec!["read".to_string(), "write".to_string()]
        );
    }

    #[test]
    fn normalize_mcp_server_trims_and_validates_inputs() {
        let server = normalize_mcp_server(McpServerAddParams {
            name: " files ".to_string(),
            endpoint: " stdio:npx -y files ".to_string(),
            tools: vec![
                " read ".to_string(),
                "read".to_string(),
                "write".to_string(),
            ],
            enabled: true,
        })
        .unwrap();

        assert_eq!(server.name, "files");
        assert_eq!(server.endpoint, "stdio:npx -y files");
        assert_eq!(server.tools, vec!["read".to_string(), "write".to_string()]);
        assert!(server.enabled);

        assert!(normalize_mcp_server(McpServerAddParams {
            name: "bad name".to_string(),
            endpoint: "stdio:npx".to_string(),
            tools: Vec::new(),
            enabled: true,
        })
        .is_err());
        assert!(normalize_mcp_server(McpServerAddParams {
            name: "files".to_string(),
            endpoint: "ftp://example.com".to_string(),
            tools: Vec::new(),
            enabled: true,
        })
        .is_err());
    }
}
