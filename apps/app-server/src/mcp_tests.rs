use super::*;

use rmcp::{
    model::{
        CallToolRequestParams, CallToolResult, Content, ElicitationSchema, ErrorData,
        Implementation, ListPromptsResult, ListResourceTemplatesResult, ListResourcesResult,
        ListToolsResult, ProtocolVersion, RawResource, RawResourceTemplate, ReadResourceResult,
        ResourceContents, ResourceTemplate, ServerCapabilities, ServerInfo,
    },
    service::RequestContext,
    RoleServer, ServerHandler,
};
use taskforceai_app_protocol::OutgoingMessage;
use tokio::task::JoinHandle;

#[tokio::test]
async fn mcp_operation_timeout_is_bounded_and_actionable() {
    let error = timeout_mcp_with(
        Duration::from_millis(1),
        "test operation",
        std::future::pending::<()>(),
    )
    .await
    .expect_err("pending MCP operation should time out");
    assert!(matches!(
        error,
        AppServerMcpError::Timeout("test operation")
    ));
}

#[test]
fn default_client_info_exposes_app_server_identity() {
    let info = AppServerMcpClientHandler::default().get_info();

    assert_eq!(
        format!("{:?}", AppServerMcpManager::default()),
        "AppServerMcpManager { .. }"
    );

    assert_eq!(info.protocol_version, ProtocolVersion::default());
    assert_eq!(info.client_info.name, APP_SERVER_MCP_CLIENT_NAME);
    assert_eq!(info.client_info.version, APP_SERVER_MCP_CLIENT_VERSION);
    assert_eq!(
        info.client_info.title.as_deref(),
        Some("TaskForceAI App Server")
    );
}

#[test]
fn discovery_pagination_advances_stops_and_rejects_bad_cursors() {
    let mut pagination = DiscoveryPagination::default();

    assert!(pagination.advance(Some(" first ".to_string())).unwrap());
    assert_eq!(pagination.cursor.as_deref(), Some("first"));
    assert!(!pagination.advance(None).unwrap());

    let mut pagination = DiscoveryPagination::default();
    let err = pagination.advance(Some("   ".to_string())).unwrap_err();
    assert!(err
        .to_string()
        .contains("pagination cursor did not advance"));

    let mut pagination = DiscoveryPagination::default();
    assert!(pagination.advance(Some("same".to_string())).unwrap());
    let err = pagination.advance(Some("same".to_string())).unwrap_err();
    assert!(err.to_string().contains("pagination cursor repeated"));
}

#[test]
fn discovery_pagination_rejects_excessive_pages_and_items() {
    let mut pagination = DiscoveryPagination::default();
    for page in 0..(MAX_MCP_DISCOVERY_PAGES - 1) {
        assert!(
            pagination.advance(Some(format!("cursor-{page}"))).unwrap(),
            "page {page} should advance"
        );
    }
    let err = pagination
        .advance(Some("cursor-limit".to_string()))
        .unwrap_err();
    assert!(err.to_string().contains("page count exceeded"));

    let pagination = DiscoveryPagination::default();
    assert!(pagination.check_items(MAX_MCP_DISCOVERY_ITEMS).is_ok());

    let err = pagination
        .check_items(MAX_MCP_DISCOVERY_ITEMS + 1)
        .unwrap_err();

    assert!(err.to_string().contains("item count exceeded"));
}

#[test]
fn trim_helpers_normalize_empty_and_present_values() {
    assert_eq!(trim_value("  app-server  "), "app-server");
    assert_eq!(trim_option(Some("  title  ")), "title");
    assert_eq!(trim_option(Some("   ")), "");
    assert_eq!(trim_option(None), "");
}

#[test]
fn session_keys_are_stable_and_trimmed() {
    assert_eq!(
        http_session_key(" https://example.com/mcp "),
        "http:https://example.com/mcp"
    );
    assert_eq!(
        stdio_session_key(
            " npx ",
            &[
                "-y".to_string(),
                "@modelcontextprotocol/server-filesystem".to_string()
            ]
        ),
        "stdio:npx\u{0}-y\u{0}@modelcontextprotocol/server-filesystem"
    );
}

struct DiscoveryFixtureServer;

impl ServerHandler for DiscoveryFixtureServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(
            ServerCapabilities::builder()
                .enable_tools()
                .enable_prompts()
                .enable_resources()
                .build(),
        )
        .with_server_info(
            Implementation::new(" fixture-mcp ", " 1.2.3 ").with_title(" Fixture MCP Server "),
        )
        .with_instructions(" Use fixture tools carefully ")
    }

    async fn list_tools(
        &self,
        request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        let cursor = request.and_then(|params| params.cursor);
        let mut schema = serde_json::Map::new();
        schema.insert(
            "type".to_string(),
            serde_json::Value::String("object".to_string()),
        );

        match cursor.as_deref() {
            None => {
                let mut tool = Tool::new("fixture_search", " Search fixture docs ", schema);
                tool.title = Some(" Fixture Search ".to_string());
                Ok(ListToolsResult {
                    tools: vec![tool],
                    next_cursor: Some(" second ".to_string()),
                    ..Default::default()
                })
            }
            Some("second") => {
                let mut tool = Tool::new("fixture_read", " Read fixture resource ", schema);
                tool.title = Some(" Fixture Read ".to_string());
                Ok(ListToolsResult {
                    tools: vec![tool],
                    ..Default::default()
                })
            }
            other => Err(ErrorData::invalid_request(
                format!("unexpected cursor: {other:?}"),
                None,
            )),
        }
    }

    async fn list_prompts(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListPromptsResult, ErrorData> {
        Ok(ListPromptsResult {
            prompts: vec![
                Prompt::new("fixture_prompt", Some(" Summarize fixture data "), None)
                    .with_title(" Fixture Prompt "),
            ],
            ..Default::default()
        })
    }

    async fn list_resources(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListResourcesResult, ErrorData> {
        Ok(ListResourcesResult {
            resources: vec![Resource::new(
                RawResource {
                    uri: "file:///fixture/readme.md".to_string(),
                    name: "fixture_readme".to_string(),
                    title: Some(" Fixture Readme ".to_string()),
                    description: Some(" Fixture resource docs ".to_string()),
                    mime_type: Some(" text/markdown ".to_string()),
                    size: None,
                    icons: None,
                    meta: None,
                },
                None,
            )],
            ..Default::default()
        })
    }

    async fn list_resource_templates(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListResourceTemplatesResult, ErrorData> {
        Ok(ListResourceTemplatesResult {
            resource_templates: vec![ResourceTemplate::new(
                RawResourceTemplate::new("file:///fixture/{name}.md", "fixture_document")
                    .with_title(" Fixture Document ")
                    .with_description(" Fixture document template ")
                    .with_mime_type(" text/markdown "),
                None,
            )],
            ..Default::default()
        })
    }

    async fn read_resource(
        &self,
        request: ReadResourceRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<ReadResourceResult, ErrorData> {
        Ok(ReadResourceResult::new(vec![ResourceContents::text(
            "fixture contents",
            request.uri,
        )]))
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        Ok(CallToolResult::success(vec![Content::text(format!(
            "called {}",
            request.name
        ))]))
    }
}

struct FailingToolsServer;

impl ServerHandler for FailingToolsServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("failing-tools", "1.0.0"))
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        Err(ErrorData::internal_error(
            "tool listing failed".to_string(),
            None,
        ))
    }
}

struct FailingResourceServer;

impl ServerHandler for FailingResourceServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_resources().build())
            .with_server_info(Implementation::new("failing-resource", "1.0.0"))
    }

    async fn read_resource(
        &self,
        _request: ReadResourceRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<ReadResourceResult, ErrorData> {
        Err(ErrorData::internal_error("read failed".to_string(), None))
    }
}

struct ElicitationFixtureServer;

impl ServerHandler for ElicitationFixtureServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("elicitation-fixture", "1.0.0"))
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let params = if request.name == "url" {
            CreateElicitationRequestParams::UrlElicitationParams {
                meta: None,
                message: "Open the fixture form".to_string(),
                url: "https://example.com/form".to_string(),
                elicitation_id: "fixture-elicitation".to_string(),
            }
        } else {
            CreateElicitationRequestParams::FormElicitationParams {
                meta: None,
                message: "Enter a fixture name".to_string(),
                requested_schema: ElicitationSchema::builder()
                    .string_property("name", |property| property)
                    .build()
                    .expect("valid fixture schema"),
            }
        };
        let result = context
            .peer
            .create_elicitation(params)
            .await
            .map_err(|error| ErrorData::internal_error(error.to_string(), None))?;
        Ok(CallToolResult::success(vec![Content::text(format!(
            "{:?}",
            result.action
        ))]))
    }
}

async fn cached_session_for_server<S>(server: S) -> (Arc<Mutex<McpSession>>, JoinHandle<()>)
where
    S: ServerHandler + Send + Sync + 'static,
{
    let (server_transport, client_transport) = tokio::io::duplex(4096);
    let server_handle = tokio::spawn(async move {
        let server = server
            .serve(server_transport)
            .await
            .expect("server should initialize");
        server.waiting().await.expect("server should stop cleanly");
    });
    let session = AppServerMcpClientHandler::default()
        .serve(client_transport)
        .await
        .expect("client should initialize");

    (Arc::new(Mutex::new(session)), server_handle)
}

async fn elicitation_session(
    handler: AppServerMcpClientHandler,
) -> (Arc<Mutex<McpSession>>, JoinHandle<()>) {
    let (server_transport, client_transport) = tokio::io::duplex(4096);
    let server_handle = tokio::spawn(async move {
        let server = ElicitationFixtureServer
            .serve(server_transport)
            .await
            .expect("server should initialize");
        server.waiting().await.expect("server should stop cleanly");
    });
    let session = handler
        .serve(client_transport)
        .await
        .expect("client should initialize");
    (Arc::new(Mutex::new(session)), server_handle)
}

#[tokio::test]
async fn elicitation_handler_declines_without_a_broker() {
    let (session, server_handle) = elicitation_session(AppServerMcpClientHandler::default()).await;
    let result = session
        .lock()
        .await
        .peer()
        .call_tool(CallToolRequestParams::new("form"))
        .await
        .expect("fixture call should complete");
    assert_eq!(result.content[0].as_text().expect("text").text, "Decline");
    session.lock().await.close().await.expect("close client");
    server_handle.await.expect("server task");
}

#[tokio::test]
async fn elicitation_handler_maps_form_url_and_response_actions() {
    for (tool, response, expected_action) in [
        (
            "form",
            serde_json::json!({"action": "accept", "content": {"name": "Ada"}}),
            "Accept",
        ),
        ("url", serde_json::json!({"action": "cancel"}), "Cancel"),
        ("form", serde_json::json!({"action": "other"}), "Decline"),
    ] {
        let (output, mut messages) = tokio::sync::mpsc::channel(8);
        let broker = InteractionBroker::new(output);
        let handler = AppServerMcpClientHandler {
            interaction_broker: Some(broker.clone()),
            context_id: "fixture-context".to_string(),
            ..Default::default()
        };
        let (session, server_handle) = elicitation_session(handler).await;
        let call = {
            let session = session.clone();
            let tool = tool.to_string();
            tokio::spawn(async move {
                session
                    .lock()
                    .await
                    .peer()
                    .call_tool(CallToolRequestParams::new(tool))
                    .await
            })
        };
        let OutgoingMessage::Request(request) = messages.recv().await.expect("elicitation") else {
            panic!("expected elicitation request");
        };
        assert_eq!(request.method, "mcpServer/elicitation/request");
        assert_eq!(request.params["threadId"], "fixture-context");
        assert_eq!(request.params["serverName"], "fixture-context");
        if tool == "url" {
            assert_eq!(request.params["mode"], "url");
            assert_eq!(request.params["url"], "https://example.com/form");
        } else {
            assert_eq!(request.params["mode"], "form");
            assert!(request.params["requestedSchema"].is_object());
        }
        assert!(
            broker
                .resolve(taskforceai_app_protocol::JsonRpcResponse {
                    jsonrpc: taskforceai_app_protocol::JSONRPC_VERSION.to_string(),
                    id: Some(request.id),
                    result: Some(response),
                    error: None,
                })
                .await
        );
        let result = call
            .await
            .expect("call task")
            .expect("fixture call should complete");
        assert_eq!(
            result.content[0].as_text().expect("text").text,
            expected_action
        );
        let _ = messages.recv().await.expect("resolved notification");
        session.lock().await.close().await.expect("close client");
        server_handle.await.expect("server task");
    }

    let (output, output_rx) = tokio::sync::mpsc::channel(1);
    drop(output_rx);
    let handler = AppServerMcpClientHandler {
        interaction_broker: Some(InteractionBroker::new(output)),
        ..Default::default()
    };
    let (session, server_handle) = elicitation_session(handler).await;
    assert!(session
        .lock()
        .await
        .peer()
        .call_tool(CallToolRequestParams::new("form"))
        .await
        .is_err());
    session.lock().await.close().await.expect("close client");
    server_handle.await.expect("server task");
}

#[tokio::test]
async fn discover_session_lists_capabilities_through_in_process_mcp() {
    let (session, server_handle) = cached_session_for_server(DiscoveryFixtureServer).await;

    let snapshot = AppServerMcpManager::default()
        .discover_session(session.clone(), McpServerStatusDetail::Full)
        .await
        .expect("discovery should succeed");

    assert_eq!(
        snapshot.protocol_version,
        ProtocolVersion::default().to_string()
    );
    assert_eq!(snapshot.server_name, "fixture-mcp");
    assert_eq!(snapshot.server_title, "Fixture MCP Server");
    assert_eq!(snapshot.server_version, "1.2.3");
    assert_eq!(snapshot.instructions, "Use fixture tools carefully");
    assert_eq!(snapshot.tools.len(), 2);
    assert_eq!(snapshot.tools[0].name, "fixture_search");
    assert_eq!(snapshot.tools[0].title, "Fixture Search");
    assert_eq!(snapshot.tools[0].description, "Search fixture docs");
    assert_eq!(snapshot.tools[0].input_schema["type"], "object");
    assert_eq!(snapshot.tools[1].name, "fixture_read");
    assert_eq!(snapshot.prompts.len(), 1);
    assert_eq!(snapshot.prompts[0].title, "Fixture Prompt");
    assert_eq!(snapshot.prompts[0].description, "Summarize fixture data");
    assert_eq!(snapshot.resources.len(), 1);
    assert_eq!(snapshot.resources[0].name, "fixture_readme");
    assert_eq!(snapshot.resources[0].title, "Fixture Readme");
    assert_eq!(snapshot.resources[0].description, "Fixture resource docs");
    assert_eq!(snapshot.resources[0].uri, "file:///fixture/readme.md");
    assert_eq!(snapshot.resources[0].mime_type, "text/markdown");
    assert_eq!(snapshot.resource_templates.len(), 1);
    assert_eq!(
        snapshot.resource_templates[0].uri_template,
        "file:///fixture/{name}.md"
    );
    assert_eq!(
        snapshot.resource_templates[0].description,
        "Fixture document template"
    );

    session
        .lock()
        .await
        .close()
        .await
        .expect("client should close");
    server_handle.await.expect("server task should finish");
}

#[tokio::test]
async fn tools_only_discovery_skips_full_inventory_calls() {
    let (session, server_handle) = cached_session_for_server(DiscoveryFixtureServer).await;

    let snapshot = AppServerMcpManager::default()
        .discover_session(session.clone(), McpServerStatusDetail::ToolsAndAuthOnly)
        .await
        .expect("tools-only discovery should succeed");

    assert_eq!(snapshot.tools.len(), 2);
    assert!(snapshot.prompts.is_empty());
    assert!(snapshot.resources.is_empty());
    assert!(snapshot.resource_templates.is_empty());

    session
        .lock()
        .await
        .close()
        .await
        .expect("client should close");
    server_handle.await.expect("server task should finish");
}

#[tokio::test]
async fn cached_sessions_return_without_spawning_and_errors_evict_cache_entries() {
    let manager = AppServerMcpManager::default();
    let endpoint = "http://cached.example/mcp";
    let http_key = http_session_key(endpoint);
    let (session, server_handle) = cached_session_for_server(FailingToolsServer).await;
    manager
        .sessions
        .lock()
        .await
        .insert(http_key.clone(), session.clone());

    let err = manager
        .discover_http(endpoint)
        .await
        .expect_err("cached HTTP discovery should surface list failure");
    assert!(matches!(err, AppServerMcpError::ListTools(_)));
    assert!(!manager.sessions.lock().await.contains_key(&http_key));
    session
        .lock()
        .await
        .close()
        .await
        .expect("client should close");
    server_handle.await.expect("server task should finish");

    let command = "cached-command";
    let args = vec!["--fixture".to_string()];
    let stdio_key = stdio_session_key(command, &args);
    let (session, server_handle) = cached_session_for_server(FailingToolsServer).await;
    manager
        .sessions
        .lock()
        .await
        .insert(stdio_key.clone(), session.clone());

    let err = manager
        .discover_stdio(command, &args)
        .await
        .expect_err("cached stdio discovery should surface list failure");
    assert!(matches!(err, AppServerMcpError::ListTools(_)));
    assert!(!manager.sessions.lock().await.contains_key(&stdio_key));
    session
        .lock()
        .await
        .close()
        .await
        .expect("client should close");
    server_handle.await.expect("server task should finish");
}

#[tokio::test]
async fn cached_sessions_support_resource_reads_and_reload() {
    let manager = AppServerMcpManager::default();
    let endpoint = "http://fixture.example/mcp";
    let key = http_session_key(endpoint);
    let (session, server_handle) = cached_session_for_server(DiscoveryFixtureServer).await;
    manager.sessions.lock().await.insert(key, session.clone());

    let resource = manager
        .read_resource_http(endpoint, "file:///fixture/readme.md")
        .await
        .expect("resource read should succeed");
    assert_eq!(resource["contents"][0]["text"], "fixture contents");

    assert_eq!(manager.reload().await, 1);
    assert_eq!(manager.reload().await, 0);
    manager
        .set_auth_token(endpoint, Some("oauth-token".to_string()))
        .await;
    assert_eq!(
        manager
            .auth_tokens
            .read()
            .expect("auth tokens")
            .get(endpoint)
            .map(String::as_str),
        Some("oauth-token")
    );
    manager.set_auth_token(endpoint, None).await;
    assert!(!manager
        .auth_tokens
        .read()
        .expect("auth tokens")
        .contains_key(endpoint));

    session
        .lock()
        .await
        .close()
        .await
        .expect("client should close");
    server_handle.await.expect("server task should finish");
}

#[tokio::test]
async fn cached_stdio_resource_reads_work_and_failures_evict_sessions() {
    let manager = AppServerMcpManager::default();
    let command = "fixture-command";
    let args = vec!["--fixture".to_string()];
    let key = stdio_session_key(command, &args);
    let (session, server_handle) = cached_session_for_server(DiscoveryFixtureServer).await;
    manager
        .sessions
        .lock()
        .await
        .insert(key.clone(), session.clone());
    let resource = manager
        .read_resource_stdio(command, &args, " file:///fixture/readme.md ")
        .await
        .expect("cached stdio resource read");
    assert_eq!(resource["contents"][0]["text"], "fixture contents");
    session.lock().await.close().await.expect("close client");
    server_handle.await.expect("server task");

    let (session, server_handle) = cached_session_for_server(FailingResourceServer).await;
    manager
        .sessions
        .lock()
        .await
        .insert(key.clone(), session.clone());
    assert!(manager
        .read_resource_stdio(command, &args, "file:///failure")
        .await
        .is_err());
    assert!(!manager.sessions.lock().await.contains_key(&key));
    session.lock().await.close().await.expect("close client");
    server_handle.await.expect("server task");
}

#[tokio::test]
async fn discovery_constructors_map_failures_and_keep_cache_clean() {
    let manager = AppServerMcpManager::default();

    manager
        .set_auth_token("http://127.0.0.1:9/mcp", Some(" token ".to_string()))
        .await;

    let http_err = manager
        .discover_http("http://127.0.0.1:9/mcp")
        .await
        .expect_err("unreachable HTTP MCP should fail initialization");
    assert!(matches!(http_err, AppServerMcpError::Initialize(_)));
    assert!(manager.sessions.lock().await.is_empty());

    let stdio_err = manager
        .discover_stdio("/definitely/missing/taskforceai-mcp", &[])
        .await
        .expect_err("missing stdio MCP command should fail spawn");
    assert!(matches!(stdio_err, AppServerMcpError::Spawn(_)));
    assert!(manager.sessions.lock().await.is_empty());
}
