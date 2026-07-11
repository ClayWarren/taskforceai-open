use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread;

use crate::protocol::{AppResponse, ModelSelectParams, OllamaEnsureParams, OllamaStatusParams};

use super::{AppRuntime, RuntimeConfig};

#[test]
fn model_command_handlers_cover_local_selection_reset_and_usage_edges() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());

    let current = runtime
        .handle_model_command(&[])
        .expect("current model should render");
    assert!(current.message.contains("Current model"));

    let listed = runtime
        .handle_model_command(&["list"])
        .expect("model list should render");
    assert!(listed.message.contains("Use /model set"));

    let reset = runtime
        .handle_model_command(&["reset"])
        .expect("model reset should work");
    assert!(reset.message.contains("default"));

    let usage = runtime
        .handle_model_command(&["set"])
        .expect("empty model set should render usage");
    assert!(!usage.handled);

    let selected = runtime
        .handle_model_command(&["zai/glm-5.2"])
        .expect("bare model id should select");
    assert!(selected.message.contains("zai/glm-5.2"));

    let empty = runtime
        .set_model_metadata("   ")
        .expect_err("empty model metadata should fail");
    assert_eq!(empty.message, "modelId is required");
}

#[tokio::test]
async fn model_runtime_methods_cover_remote_catalog_and_ollama_wrappers() {
    let api_base_url = spawn_single_response_server(
        r#"{"enabled":true,"defaultModelId":"sentinel/default","options":[{"id":"sentinel/fast","label":"Sentinel Fast","badge":"fast","description":"Fast lane","usageMultiple":1.5}]}"#,
    );
    let mut runtime = AppRuntime::new(RuntimeConfig {
        api_base_url,
        remote_model_catalog: true,
        ..RuntimeConfig::default()
    });
    runtime
        .set_model_metadata("sentinel/selected")
        .expect("selected model should store");

    let remote = runtime
        .model_list_result()
        .await
        .expect("remote model catalog should load");
    assert!(remote.remote_catalog);
    assert_eq!(remote.default_model_id, "sentinel/selected");
    assert_eq!(remote.options[0].usage_multiple, Some(1.5));

    let selected = response_value(
        runtime
            .model_select(ModelSelectParams {
                model_id: "sentinel/direct".to_string(),
            })
            .await
            .expect("model select should return list"),
    );
    assert_eq!(selected["selectedModelId"], "sentinel/direct");

    let reset = response_value(
        runtime
            .model_reset()
            .await
            .expect("model reset should list"),
    );
    assert_eq!(reset["selectedModelId"], serde_json::Value::Null);

    let listed = response_value(runtime.model_list().await.expect("model list should work"));
    assert_eq!(listed["remoteCatalog"], false);

    let configured = AppRuntime::new(RuntimeConfig {
        ollama_base_url: "http://configured.example/v1/".to_string(),
        ..RuntimeConfig::default()
    });
    assert_eq!(
        configured.ollama_base_url(Some(" http://override.example/v1/ ".to_string())),
        "http://override.example/v1"
    );
    assert_eq!(
        configured.ollama_base_url(None),
        "http://configured.example/v1/"
    );

    let ollama_base_url = spawn_ollama_server(true);
    let status = response_value(
        configured
            .ollama_status(OllamaStatusParams {
                base_url: Some(format!("{ollama_base_url}/v1")),
            })
            .await
            .expect("ollama status should map"),
    );
    assert_eq!(status["connected"], true);
    assert_eq!(status["version"], "0.13.4");

    let ensured = response_value(
        configured
            .ollama_ensure(OllamaEnsureParams {
                base_url: Some(format!("{ollama_base_url}/v1")),
                model_id: Some("gemma4:e2b".to_string()),
            })
            .await
            .expect("ollama ensure should map"),
    );
    assert_eq!(ensured["model"], "gemma4:e2b");
    assert_eq!(ensured["pulled"], true);
    assert!(ensured["pullEvents"].as_array().expect("events").len() >= 2);
}

fn response_value(response: AppResponse) -> serde_json::Value {
    match response {
        AppResponse::Value(value) | AppResponse::Shutdown(value) => value,
        AppResponse::WithEvents { result, .. } => result,
    }
}

fn spawn_single_response_server(body: &'static str) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind api fixture");
    let addr = listener.local_addr().expect("api fixture address");
    thread::spawn(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            let mut request = [0_u8; 1024];
            let _ = stream.read(&mut request);
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            stream
                .write_all(response.as_bytes())
                .expect("api fixture response should write");
        }
    });
    format!("http://{addr}")
}

fn spawn_ollama_server(model_missing: bool) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind ollama fixture");
    let addr = listener.local_addr().expect("ollama fixture address");
    thread::spawn(move || {
        for stream in listener.incoming().take(12) {
            let Ok(mut stream) = stream else {
                continue;
            };
            let mut request = [0_u8; 2048];
            let count = stream.read(&mut request).unwrap_or_default();
            let request = String::from_utf8_lossy(&request[..count]);
            let path = request
                .lines()
                .next()
                .and_then(|line| line.split_whitespace().nth(1))
                .unwrap_or("/");
            let body = match path {
                "/v1/models" => r#"{"data":[]}"#,
                "/api/version" => r#"{"version":"0.13.4"}"#,
                "/api/tags" if model_missing => r#"{"models":[]}"#,
                "/api/tags" => r#"{"models":[{"name":"gemma4:e2b"}]}"#,
                "/api/pull" => {
                    r#"{"status":"pulling manifest"}
{"digest":"sha256:test","completed":1,"total":2}
{"status":"success"}
"#
                }
                _ => r#"{"error":"not found"}"#,
            };
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            stream
                .write_all(response.as_bytes())
                .expect("ollama fixture response should write");
        }
    });
    format!("http://{addr}")
}
