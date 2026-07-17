use taskforceai_app_protocol::ApiRequestParams;

use crate::protocol::AppResponse;

use super::{util::value, AppRuntime, RuntimeError};

impl AppRuntime {
    pub async fn api_request(&self, params: ApiRequestParams) -> Result<AppResponse, RuntimeError> {
        validate_api_request(&params)?;
        let token = self
            .auth_token()?
            .ok_or_else(|| RuntimeError::not_configured("login required for api.request"))?;
        let result = self.api_client.request_json(&token, params).await?;
        Ok(value(result))
    }
}

fn validate_api_request(params: &ApiRequestParams) -> Result<(), RuntimeError> {
    let method = params.method.trim().to_ascii_uppercase();
    if !matches!(method.as_str(), "GET" | "POST" | "PATCH" | "DELETE") {
        return Err(RuntimeError::invalid_params(
            "api.request method is not allowed",
        ));
    }

    let path = params.path.trim();
    if !path.starts_with("/api/v1/") || path.contains('\\') || path.contains('#') {
        return Err(RuntimeError::invalid_params("api.request path is invalid"));
    }
    let path_only = path.split('?').next().unwrap_or_default();
    if path_only
        .split('/')
        .any(|segment| matches!(segment, "." | ".."))
        || path_only.to_ascii_lowercase().contains("%2e")
    {
        return Err(RuntimeError::invalid_params("api.request path is invalid"));
    }
    let relative = &path_only[8..];
    let segments = relative.split('/').collect::<Vec<_>>();
    let allowed = match (method.as_str(), segments.as_slice()) {
        ("GET" | "POST", ["agents"]) => true,
        ("GET", ["artifacts"]) => true,
        ("GET" | "PATCH" | "DELETE", ["artifacts", id]) => !id.is_empty(),
        ("GET", ["artifacts", id, "versions"]) => !id.is_empty(),
        ("POST" | "DELETE", ["artifacts", id, "share", "public"]) => !id.is_empty(),
        ("GET", ["finances"]) => true,
        ("POST", ["finances", "memories" | "link-token" | "exchange-public-token" | "sync"]) => {
            true
        }
        ("DELETE", ["finances", "connections" | "memories", id]) => {
            !id.is_empty() && id.bytes().all(|value| value.is_ascii_digit())
        }
        _ => false,
    };
    if !allowed {
        return Err(RuntimeError::invalid_params(
            "api.request path is not available to the desktop bridge",
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    use serde_json::json;
    use taskforceai_app_protocol::ApiRequestParams;

    use super::{validate_api_request, AppRuntime};
    use crate::runtime::RuntimeConfig;

    #[test]
    fn desktop_api_bridge_allows_product_pages_and_rejects_other_routes() {
        for (method, path) in [
            ("GET", "/api/v1/agents"),
            ("POST", "/api/v1/agents"),
            ("GET", "/api/v1/artifacts?include=currentVersion"),
            ("GET", "/api/v1/artifacts/artifact-1/versions"),
            ("PATCH", "/api/v1/artifacts/artifact-1"),
            ("POST", "/api/v1/artifacts/artifact-1/share/public"),
            ("DELETE", "/api/v1/artifacts/artifact-1"),
            ("GET", "/api/v1/finances"),
            ("POST", "/api/v1/finances/sync"),
            ("DELETE", "/api/v1/finances/connections/1"),
        ] {
            validate_api_request(&ApiRequestParams {
                method: method.to_string(),
                path: path.to_string(),
                body: Some(json!({"value": true})),
            })
            .expect("product page request should be allowed");
        }

        for (method, path) in [
            ("PUT", "/api/v1/agents"),
            ("GET", "/api/v1/auth/status"),
            ("GET", "https://attacker.example/api/v1/agents"),
            ("GET", "/api/v1/../admin"),
            ("GET", "/api/v1/artifacts/.."),
            ("GET", "/api/v1/artifacts/%2e%2e"),
            ("GET", "/api/v1/agents/private"),
            ("POST", "/api/v1/finances/not-an-operation"),
            ("DELETE", "/api/v1/finances/connections/not-a-number"),
            ("GET", "/api/v1/agents#fragment"),
        ] {
            assert!(validate_api_request(&ApiRequestParams {
                method: method.to_string(),
                path: path.to_string(),
                body: None,
            })
            .is_err());
        }
    }

    #[tokio::test]
    async fn desktop_api_bridge_runtime_requires_login_and_forwards_requests() {
        let params = ApiRequestParams {
            method: "GET".to_string(),
            path: "/api/v1/artifacts".to_string(),
            body: None,
        };
        assert!(AppRuntime::new(RuntimeConfig::default())
            .api_request(params.clone())
            .await
            .is_err());

        let listener = TcpListener::bind("127.0.0.1:0").expect("API bridge should bind");
        let address = listener.local_addr().expect("API bridge address");
        let server = thread::spawn(move || {
            for (body, extra_headers) in [
                (
                    r#"{"csrfToken":"csrf-token"}"#,
                    "Set-Cookie: csrf_token=csrf-token; Path=/\r\n",
                ),
                (r#"{"items":[]}"#, ""),
            ] {
                let (mut stream, _) = listener.accept().expect("API bridge request");
                let mut request = [0_u8; 2048];
                let _ = stream.read(&mut request).expect("read API bridge request");
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n{extra_headers}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                stream
                    .write_all(response.as_bytes())
                    .expect("write API bridge response");
            }
        });
        let mut runtime = AppRuntime::new(RuntimeConfig {
            api_base_url: format!("http://{address}/api/v1"),
            ..RuntimeConfig::default()
        });
        runtime
            .set_auth_token(Some("token"))
            .expect("set auth token");
        runtime
            .api_request(params)
            .await
            .expect("forward API bridge request");
        server.join().expect("API bridge server should finish");
    }
}
