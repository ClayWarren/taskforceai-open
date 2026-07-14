use super::*;
use std::{path::PathBuf, sync::OnceLock};
use tokio::sync::{Mutex, MutexGuard};

const FIXTURE_STARTUP_COUNTER_ENV: &str = "TASKFORCEAI_DESKTOP_MCP_FIXTURE_STARTUP_COUNT";

struct LocalProcessMcpEnvGuard {
    _guard: MutexGuard<'static, ()>,
    previous: Option<String>,
}

impl Drop for LocalProcessMcpEnvGuard {
    fn drop(&mut self) {
        match &self.previous {
            Some(value) => std::env::set_var(ALLOW_LOCAL_PROCESS_MCP_ENV, value),
            None => std::env::remove_var(ALLOW_LOCAL_PROCESS_MCP_ENV),
        }
    }
}

struct EnvVarGuard {
    key: &'static str,
    previous: Option<String>,
}

impl EnvVarGuard {
    fn set(key: &'static str, value: String) -> Self {
        let previous = std::env::var(key).ok();
        std::env::set_var(key, value);
        Self { key, previous }
    }
}

impl Drop for EnvVarGuard {
    fn drop(&mut self) {
        match &self.previous {
            Some(value) => std::env::set_var(self.key, value),
            None => std::env::remove_var(self.key),
        }
    }
}

fn local_process_mcp_env_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

async fn enable_local_process_mcp_for_test() -> LocalProcessMcpEnvGuard {
    let guard = local_process_mcp_env_lock().lock().await;
    let previous = std::env::var(ALLOW_LOCAL_PROCESS_MCP_ENV).ok();
    std::env::set_var(ALLOW_LOCAL_PROCESS_MCP_ENV, "true");
    LocalProcessMcpEnvGuard {
        _guard: guard,
        previous,
    }
}

async fn disable_local_process_mcp_for_test() -> LocalProcessMcpEnvGuard {
    let guard = local_process_mcp_env_lock().lock().await;
    let previous = std::env::var(ALLOW_LOCAL_PROCESS_MCP_ENV).ok();
    std::env::remove_var(ALLOW_LOCAL_PROCESS_MCP_ENV);
    LocalProcessMcpEnvGuard {
        _guard: guard,
        previous,
    }
}

#[test]
fn parses_streamable_http_endpoint() {
    let endpoint = parse_endpoint_spec("https://example.com/mcp").expect("http endpoint");
    assert_eq!(endpoint.kind, DesktopMcpEndpointKind::StreamableHttp);
    assert_eq!(endpoint.url.as_deref(), Some("https://example.com/mcp"));
}

#[test]
fn parses_stdio_command_endpoint() {
    let endpoint = parse_endpoint_spec("npx -y @modelcontextprotocol/server-filesystem /tmp")
        .expect("stdio endpoint");
    assert_eq!(endpoint.kind, DesktopMcpEndpointKind::Stdio);
    assert_eq!(endpoint.command.as_deref(), Some("npx"));
    assert_eq!(
        endpoint.args,
        vec![
            "-y".to_owned(),
            "@modelcontextprotocol/server-filesystem".to_owned(),
            "/tmp".to_owned()
        ]
    );
}

#[test]
fn parses_windows_absolute_stdio_command_endpoint() {
    let endpoint = parse_endpoint_spec(r"C:\tools\server.exe --config C:\tmp\mcp.json")
        .expect("windows stdio endpoint");
    assert_eq!(endpoint.kind, DesktopMcpEndpointKind::Stdio);
    assert_eq!(endpoint.command.as_deref(), Some(r"C:\tools\server.exe"));
    assert_eq!(
        endpoint.args,
        vec!["--config".to_owned(), r"C:\tmp\mcp.json".to_owned()]
    );
}

#[test]
fn parses_stdio_url_endpoint() {
    let endpoint = parse_endpoint_spec("stdio://node?arg=server.js&arg=--port&arg=3333")
        .expect("stdio url endpoint");
    assert_eq!(endpoint.command.as_deref(), Some("node"));
    assert_eq!(
        endpoint.args,
        vec![
            "server.js".to_owned(),
            "--port".to_owned(),
            "3333".to_owned()
        ]
    );
}

#[test]
fn client_handler_reports_desktop_identity() {
    let handler = DesktopMcpClientHandler::default();
    let info = handler.get_info();
    assert_eq!(info.client_info.name, DESKTOP_MCP_CLIENT_NAME);
    assert_eq!(info.client_info.version, DESKTOP_MCP_CLIENT_VERSION);
    assert_eq!(
        info.client_info.title.as_deref(),
        Some("TaskForceAI Desktop")
    );
}

#[test]
fn endpoint_parsing_covers_errors_and_legacy_forms() {
    let missing = parse_endpoint_spec("  ").expect_err("blank endpoint should fail");
    assert!(matches!(missing, DesktopMcpManagerError::MissingEndpoint));

    let missing_command =
        parse_endpoint_spec("stdio://   ").expect_err("blank stdio command should fail");
    assert!(matches!(
        missing_command,
        DesktopMcpManagerError::MissingCommand
    ));

    let unsupported =
        parse_endpoint_spec("ftp://example.test/mcp").expect_err("unsupported scheme");
    assert!(matches!(
        unsupported,
        DesktopMcpManagerError::UnsupportedScheme(scheme) if scheme == "ftp"
    ));
    let unsupported_with_symbols =
        parse_endpoint_spec("mcp+stdio://example.test").expect_err("unsupported scheme");
    assert!(matches!(
        unsupported_with_symbols,
        DesktopMcpManagerError::UnsupportedScheme(scheme) if scheme == "mcp+stdio"
    ));

    let endpoint = parse_endpoint_spec("stdio:node \"server file.js\" 'two words' escaped\\ arg")
        .expect("stdio colon command");
    assert_eq!(
        endpoint.raw,
        "stdio:node \"server file.js\" 'two words' escaped\\ arg"
    );
    assert_eq!(endpoint.command.as_deref(), Some("node"));
    assert_eq!(
        endpoint.args,
        vec![
            "server file.js".to_owned(),
            "two words".to_owned(),
            "escaped arg".to_owned()
        ]
    );

    let odd_scheme =
        parse_endpoint_spec("not a scheme: --flag").expect("invalid scheme syntax is command");
    assert_eq!(odd_scheme.command.as_deref(), Some("not"));
}

#[test]
fn stdio_url_decodes_arguments_and_filters_blank_values() {
    let endpoint = parse_endpoint_spec(
        "stdio://python?arg=server.py&arg=hello+world&arg=%2Ftmp%2Fnotes&arg=%ZZ&arg=+",
    )
    .expect("stdio url endpoint");

    assert_eq!(endpoint.command.as_deref(), Some("python"));
    assert_eq!(
        endpoint.args,
        vec![
            "server.py".to_owned(),
            "hello world".to_owned(),
            "/tmp/notes".to_owned(),
            "%ZZ".to_owned()
        ]
    );
}

#[test]
fn command_line_parser_handles_boundaries() {
    assert_eq!(
        split_command_line("  ").expect("blank command"),
        Vec::<String>::new()
    );

    let unterminated_escape = split_command_line("node server\\").expect_err("unterminated escape");
    assert!(matches!(
        unterminated_escape,
        DesktopMcpManagerError::UnterminatedEscape
    ));

    let unterminated_quote = split_command_line("node \"server").expect_err("unterminated quote");
    assert!(matches!(
        unterminated_quote,
        DesktopMcpManagerError::UnterminatedQuote
    ));

    let parsed = split_command_line("node \"double quoted\" 'single quoted' plain").expect("parse");
    assert_eq!(
        parsed,
        vec![
            "node".to_owned(),
            "double quoted".to_owned(),
            "single quoted".to_owned(),
            "plain".to_owned()
        ]
    );
}

#[test]
fn local_normalizers_trim_and_decode_values() {
    assert_eq!(percent_decode("a+b%20c%2Fd%"), "a b c/d%");
    assert_eq!(percent_decode("%2"), "%2");
    assert_eq!(percent_decode("%ZZ"), "%ZZ");
    assert_eq!(percent_decode("%\u{20ac}"), "%\u{20ac}");
    assert_eq!(percent_decode("%F0%9F%94%A5"), "\u{1f525}");
    assert_eq!(normalize_server_key(" Files "), "files");
    assert_eq!(trim_value(" value "), "value");
    assert_eq!(trim_option(Some(" value ")), "value");
    assert_eq!(trim_option(None), "");
}

#[test]
fn session_config_matching_requires_same_endpoint_enabled_state_and_spec() {
    let server = DesktopMcpServerConfig {
        name: "local".to_owned(),
        endpoint: "https://example.test/mcp".to_owned(),
        enabled: true,
    };
    let spec = parse_endpoint_spec(server.endpoint.clone()).expect("endpoint spec");

    assert!(session_config_matches(&server, &spec, &server, &spec));

    let disabled = DesktopMcpServerConfig {
        enabled: false,
        ..server.clone()
    };
    assert!(!session_config_matches(&server, &spec, &disabled, &spec));

    let changed_endpoint = DesktopMcpServerConfig {
        endpoint: "https://example.test/other".to_owned(),
        ..server.clone()
    };
    let changed_spec = parse_endpoint_spec(changed_endpoint.endpoint.clone()).expect("spec");
    assert!(!session_config_matches(
        &server,
        &spec,
        &changed_endpoint,
        &spec
    ));
    assert!(!session_config_matches(
        &server,
        &spec,
        &changed_endpoint,
        &changed_spec
    ));
    assert!(!session_config_matches(
        &server,
        &spec,
        &server,
        &changed_spec
    ));
}

#[tokio::test]
async fn manager_validates_before_connecting() {
    let manager = DesktopMcpManager::new();

    manager.close("  ").await.expect("blank close is ok");
    manager.close("missing").await.expect("missing close is ok");
    manager.close_all().await.expect("empty close all is ok");

    let missing_name = manager
        .discover(DesktopMcpServerConfig {
            name: "  ".to_owned(),
            endpoint: "https://example.com/mcp".to_owned(),
            enabled: true,
        })
        .await
        .expect_err("missing name should fail");
    assert!(matches!(missing_name, DesktopMcpManagerError::MissingName));

    let missing_endpoint = manager
        .discover(DesktopMcpServerConfig {
            name: "local".to_owned(),
            endpoint: "  ".to_owned(),
            enabled: true,
        })
        .await
        .expect_err("missing endpoint should fail");
    assert!(matches!(
        missing_endpoint,
        DesktopMcpManagerError::MissingEndpoint
    ));

    let unsupported = manager
        .discover(DesktopMcpServerConfig {
            name: "local".to_owned(),
            endpoint: "ftp://example.com/mcp".to_owned(),
            enabled: true,
        })
        .await
        .expect_err("unsupported endpoint should fail");
    assert!(matches!(
        unsupported,
        DesktopMcpManagerError::UnsupportedScheme(scheme) if scheme == "ftp"
    ));

    let _local_process_mcp = enable_local_process_mcp_for_test().await;
    let connect = manager
        .discover(DesktopMcpServerConfig {
            name: "local".to_owned(),
            endpoint: "stdio:__taskforceai_missing_mcp_binary__".to_owned(),
            enabled: true,
        })
        .await
        .expect_err("missing binary should fail connect");
    match connect {
        DesktopMcpManagerError::Connect { server, source } => {
            assert_eq!(server, "local");
            assert!(matches!(*source, DesktopMcpConnectError::Spawn(_)));
        }
        other => panic!("unexpected error: {other:?}"),
    }
}

#[tokio::test]
async fn stdio_discover_requires_local_process_trust() {
    let _local_process_mcp = disable_local_process_mcp_for_test().await;
    let manager = DesktopMcpManager::new();

    let local_process_disabled = manager
        .discover(DesktopMcpServerConfig {
            name: "local".to_owned(),
            endpoint: "stdio:__taskforceai_missing_mcp_binary__".to_owned(),
            enabled: true,
        })
        .await
        .expect_err("stdio should require explicit desktop trust");

    assert!(matches!(
        local_process_disabled,
        DesktopMcpManagerError::LocalProcessMcpDisabled
    ));
}

#[tokio::test]
async fn disabled_server_returns_error() {
    let manager = DesktopMcpManager::new();
    let result = manager
        .discover(DesktopMcpServerConfig {
            name: "local".to_owned(),
            endpoint: "https://example.com/mcp".to_owned(),
            enabled: false,
        })
        .await;
    assert!(matches!(result, Err(DesktopMcpManagerError::Disabled(name)) if name == "local"));
}

fn fixture_server_config(name: &str) -> DesktopMcpServerConfig {
    let fixture =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/mcp/test-fixture-server.mjs");
    DesktopMcpServerConfig {
        name: name.to_owned(),
        endpoint: format!("node {}", fixture.display()),
        enabled: true,
    }
}

fn unique_mcp_test_path(name: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system time should be after epoch")
        .as_nanos();
    std::env::temp_dir().join(format!(
        "taskforceai-desktop-mcp-{name}-{}-{nanos}",
        std::process::id()
    ))
}

#[tokio::test]
async fn discover_connects_to_stdio_mcp_server() {
    let _local_process_mcp = enable_local_process_mcp_for_test().await;
    let manager = DesktopMcpManager::new();
    let server = fixture_server_config("fixture");

    let snapshot = manager
        .discover(server.clone())
        .await
        .expect("discover stdio MCP server");
    assert_eq!(snapshot.name, "fixture");
    assert_eq!(snapshot.transport, DesktopMcpEndpointKind::Stdio);
    assert!(!snapshot.server_name.is_empty());

    let reused = manager
        .discover(server.clone())
        .await
        .expect("reuse cached MCP session");
    assert_eq!(reused.endpoint, snapshot.endpoint);

    if let Some(tool) = snapshot.tools.first() {
        manager
            .call_tool(server.clone(), tool.name.clone(), Default::default())
            .await
            .expect("call MCP tool");
    }

    manager.close("fixture").await.expect("close MCP session");
    manager.close_all().await.expect("close all MCP sessions");
}

#[tokio::test]
async fn concurrent_discover_reuses_single_inflight_connect_for_same_server() {
    let _local_process_mcp = enable_local_process_mcp_for_test().await;
    let counter_path = unique_mcp_test_path("startup-count");
    let _counter_env = EnvVarGuard::set(
        FIXTURE_STARTUP_COUNTER_ENV,
        counter_path.to_string_lossy().into_owned(),
    );
    let manager = DesktopMcpManager::new();
    let server = fixture_server_config("fixture-concurrent");

    let (first, second) = tokio::join!(manager.discover(server.clone()), manager.discover(server));

    first.expect("first concurrent discover should succeed");
    second.expect("second concurrent discover should succeed");
    manager
        .close("fixture-concurrent")
        .await
        .expect("close concurrent MCP session");

    let startup_count = std::fs::read_to_string(&counter_path)
        .expect("startup counter should be written")
        .lines()
        .count();
    assert_eq!(startup_count, 1);

    let _ = std::fs::remove_file(counter_path);
}

#[tokio::test]
async fn call_tool_rejects_empty_name_after_connecting() {
    let _local_process_mcp = enable_local_process_mcp_for_test().await;
    let manager = DesktopMcpManager::new();
    let server = fixture_server_config("fixture-tool-validation");
    manager
        .discover(server.clone())
        .await
        .expect("discover MCP server for tool validation");

    let err = manager
        .call_tool(server, "   ", Default::default())
        .await
        .expect_err("empty tool name should fail");
    assert!(matches!(err, DesktopMcpManagerError::MissingToolName));

    manager
        .close("fixture-tool-validation")
        .await
        .expect("close MCP session");
}

#[tokio::test]
async fn call_tool_rejects_empty_name_before_connecting() {
    let _local_process_mcp = enable_local_process_mcp_for_test().await;
    let manager = DesktopMcpManager::new();
    let err = manager
        .call_tool(
            DesktopMcpServerConfig {
                name: "missing-binary".to_owned(),
                endpoint: "stdio:__taskforceai_missing_mcp_binary__".to_owned(),
                enabled: true,
            },
            "   ",
            Default::default(),
        )
        .await
        .expect_err("empty tool name should fail before connect");

    assert!(matches!(err, DesktopMcpManagerError::MissingToolName));
}

#[tokio::test]
async fn reconnects_when_server_configuration_changes() {
    let _local_process_mcp = enable_local_process_mcp_for_test().await;
    let manager = DesktopMcpManager::new();
    let initial = fixture_server_config("fixture-reconnect");
    manager
        .discover(initial)
        .await
        .expect("initial MCP discover");

    let changed = DesktopMcpServerConfig {
        endpoint: "stdio:__taskforceai_missing_mcp_binary__".to_owned(),
        ..fixture_server_config("fixture-reconnect")
    };
    let err = manager
        .discover(changed)
        .await
        .expect_err("changed endpoint");
    match err {
        DesktopMcpManagerError::Connect { server, source } => {
            assert_eq!(server, "fixture-reconnect");
            assert!(matches!(*source, DesktopMcpConnectError::Spawn(_)));
        }
        other => panic!("unexpected error: {other:?}"),
    }

    manager
        .close("fixture-reconnect")
        .await
        .expect("close MCP session after reconnect failure");
}
