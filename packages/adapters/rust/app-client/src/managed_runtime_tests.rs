use super::*;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

const DECODED_SIGNATURE: &str = "untrusted comment: signature from minisign secret key\nRWQf6LRCGA9i59SLOFxz6NxvASXDJeRtuZykwQepbDEGt87ig1BNpWaVWuNrm73YiIiJbq71Wi+dP9eKL8OC351vwIasSSbXxwA=\ntrusted comment: timestamp:1555779966\tfile:test\nQtKMXWyYcwdpZAlPF7tE2ENJkRd1ujvKjlj1m9RtHTBnZPa5WKU5uWRs5GoP5M/VqE81QFuMKI5k/SfNQUaOAA==";

fn temp_root(label: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "taskforceai-managed-runtime-{label}-{}-{}",
        std::process::id(),
        rand::random::<u64>()
    ))
}

async fn write_executable(path: &Path, content: &[u8]) {
    tokio::fs::write(path, content)
        .await
        .expect("write executable");
    make_executable(path).await.expect("mark executable");
}

fn http_response(status: &str, body: &[u8]) -> Vec<u8> {
    format!(
        "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    )
    .into_bytes()
    .into_iter()
    .chain(body.iter().copied())
    .collect()
}

async fn response_server(responses: Vec<Vec<u8>>) -> String {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind response server");
    let address = listener.local_addr().expect("response server address");
    tokio::spawn(async move {
        for response in responses {
            let (mut stream, _) = listener.accept().await.expect("accept request");
            let mut request = vec![0_u8; 8192];
            let _ = stream.read(&mut request).await;
            stream.write_all(&response).await.expect("write response");
        }
    });
    format!("http://{address}")
}

fn update_json(version: &str, url: &str, content: &[u8]) -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({
        "version": version,
        "protocolVersion": PROTOCOL_VERSION,
        "url": url,
        "sha256": format!("{:x}", Sha256::digest(content)),
        "signature": DECODED_SIGNATURE,
    }))
    .expect("serialize update")
}

fn test_manager(update_url: String, root: &Path, bundled: &Path) -> ManagedAppServerRuntime {
    ManagedAppServerRuntime::for_test(update_url, root.to_path_buf(), bundled.to_path_buf())
}

#[test]
fn update_endpoint_uses_public_desktop_route() {
    assert_eq!(
        update_endpoint("https://www.taskforceai.chat/api/v1"),
        format!(
            "https://www.taskforceai.chat/api/desktop/app-server/update/{}",
            runtime_target()
        )
    );
    assert_eq!(
        update_endpoint("not a url/api/v1/"),
        format!(
            "not a url/api/desktop/app-server/update/{}",
            runtime_target()
        )
    );
    assert_eq!(binary_name(), "taskforceai-app-server");
    assert!(default_managed_app_server_root().is_some());
}

#[test]
fn managed_root_uses_taskforce_home_then_user_home() {
    assert_eq!(
        managed_app_server_root_from(Some("/tmp/taskforce".into()), Some("/tmp/home".into())),
        Some(PathBuf::from("/tmp/taskforce/app-server"))
    );
    assert_eq!(
        managed_app_server_root_from(None, Some("/tmp/home".into())),
        Some(PathBuf::from("/tmp/home/.taskforceai/app-server"))
    );
    assert_eq!(managed_app_server_root_from(None, None), None);
}

#[test]
fn rejects_protocol_and_hash_mismatches() {
    let current = BUNDLED_APP_SERVER_VERSION;
    let incompatible = RuntimeUpdate {
        version: "99.0.0".to_string(),
        protocol_version: "old".to_string(),
        url: "https://example.test/server".to_string(),
        sha256: "a".repeat(64),
        signature: "invalid".to_string(),
    };
    assert!(matches!(
        validate_update(&incompatible, current),
        Err(RuntimeUpdateError::IncompatibleProtocol { .. })
    ));

    let invalid_hash = RuntimeUpdate {
        protocol_version: PROTOCOL_VERSION.to_string(),
        sha256: "nope".to_string(),
        ..incompatible
    };
    assert!(matches!(
        validate_update(&invalid_hash, current),
        Err(RuntimeUpdateError::InvalidSha256)
    ));

    let invalid_signature = RuntimeUpdate {
        sha256: "a".repeat(64),
        ..invalid_hash
    };
    assert!(matches!(
        validate_update(&invalid_signature, current),
        Err(RuntimeUpdateError::ReleaseSignature(_))
    ));

    let invalid_update_version = RuntimeUpdate {
        version: "nope".to_string(),
        signature: DECODED_SIGNATURE.to_string(),
        ..invalid_signature.clone()
    };
    assert!(matches!(
        validate_update(&invalid_update_version, current),
        Err(RuntimeUpdateError::InvalidVersion(_))
    ));
    let valid = RuntimeUpdate {
        version: "99.0.0".to_string(),
        protocol_version: PROTOCOL_VERSION.to_string(),
        sha256: "a".repeat(64),
        signature: DECODED_SIGNATURE.to_string(),
        ..invalid_update_version
    };
    assert!(matches!(
        validate_update(&valid, "invalid"),
        Err(RuntimeUpdateError::InvalidVersion(_))
    ));
    assert!(matches!(
        validate_update(
            &RuntimeUpdate {
                version: current.to_string(),
                ..valid.clone()
            },
            current
        ),
        Err(RuntimeUpdateError::NonNewerVersion)
    ));
    validate_update(&valid, current).expect("valid update should pass");
    assert!(is_sha256(&"F".repeat(64)));
    assert!(!is_sha256(&"g".repeat(64)));
}

#[tokio::test]
async fn invalid_managed_runtime_rolls_back_to_bundled_binary() {
    let root = std::env::temp_dir().join(format!(
        "taskforceai-managed-runtime-test-{}-{}",
        std::process::id(),
        rand::random::<u64>()
    ));
    let bundled = root.join("bundled");
    tokio::fs::create_dir_all(&root).await.expect("create root");
    tokio::fs::write(&bundled, b"bundled")
        .await
        .expect("write bundled");
    let manager = ManagedAppServerRuntime::for_test(
        "https://example.test/update".to_string(),
        root.clone(),
        bundled.clone(),
    );
    let selection = RuntimeSelection {
        version: "99.0.0".to_string(),
        protocol_version: PROTOCOL_VERSION.to_string(),
        sha256: "0".repeat(64),
        signature: "invalid".to_string(),
    };
    manager
        .store_selection(&selection)
        .await
        .expect("store selection");

    assert_eq!(manager.active_binary().await, bundled);
    assert!(!tokio::fs::try_exists(manager.selection_path())
        .await
        .expect("read selection state"));
    let _ = tokio::fs::remove_dir_all(root).await;
}

#[tokio::test]
async fn accessors_selection_and_rollback_cover_managed_runtime_state() {
    let root = temp_root("state");
    tokio::fs::create_dir_all(&root).await.expect("create root");
    let bundled = root.join("bundled");
    write_executable(&bundled, b"#!/bin/sh\necho taskforceai-app-server 2.0.0\n").await;
    let manager =
        ManagedAppServerRuntime::new("https://example.test/api/v1", root.clone(), bundled.clone());
    assert_eq!(manager.bundled_binary(), bundled);
    assert_eq!(manager.active_binary().await, bundled);
    assert_eq!(
        manager.bundled_version().await,
        Version::parse("2.0.0").unwrap()
    );

    let bad_version = RuntimeSelection {
        version: "bad".to_string(),
        protocol_version: PROTOCOL_VERSION.to_string(),
        sha256: "0".repeat(64),
        signature: DECODED_SIGNATURE.to_string(),
    };
    assert!(matches!(
        manager.validate_installed(&bad_version, &bundled).await,
        Err(RuntimeUpdateError::InvalidVersion(_))
    ));
    let bad_protocol = RuntimeSelection {
        version: "3.0.0".to_string(),
        protocol_version: "old".to_string(),
        ..bad_version.clone()
    };
    assert!(matches!(
        manager.validate_installed(&bad_protocol, &bundled).await,
        Err(RuntimeUpdateError::IncompatibleProtocol { .. })
    ));
    let bad_hash = RuntimeSelection {
        protocol_version: PROTOCOL_VERSION.to_string(),
        sha256: "bad".to_string(),
        ..bad_protocol
    };
    assert!(matches!(
        manager.validate_installed(&bad_hash, &bundled).await,
        Err(RuntimeUpdateError::InvalidSha256)
    ));
    let mismatch = RuntimeSelection {
        sha256: "0".repeat(64),
        ..bad_hash
    };
    assert!(matches!(
        manager.validate_installed(&mismatch, &bundled).await,
        Err(RuntimeUpdateError::HashMismatch)
    ));
    let missing = root.join("missing");
    let valid_hash = RuntimeSelection {
        sha256: format!("{:x}", Sha256::digest(b"missing")),
        ..mismatch
    };
    assert!(matches!(
        manager.validate_installed(&valid_hash, &missing).await,
        Err(RuntimeUpdateError::Io(_))
    ));

    manager
        .store_selection(&valid_hash)
        .await
        .expect("store selection");
    manager.rollback(&bundled).await;
    assert!(manager.load_selection().await.is_some());
    manager.rollback(&missing).await;
    assert!(manager.load_selection().await.is_none());
    tokio::fs::write(manager.selection_path(), b"invalid json")
        .await
        .expect("write invalid selection");
    assert!(manager.load_selection().await.is_none());
    assert!(manager
        .binary_path("3.0.0")
        .ends_with("versions/3.0.0/taskforceai-app-server"));
    let _ = tokio::fs::remove_dir_all(root).await;
}

#[tokio::test]
async fn current_version_prefers_valid_newer_managed_runtime_and_falls_back() {
    let root = temp_root("versions");
    tokio::fs::create_dir_all(&root).await.expect("create root");
    let bundled = root.join("bundled");
    write_executable(&bundled, b"#!/bin/sh\necho app-server 1.2.3\n").await;
    let manager = test_manager("https://example.test".to_string(), &root, &bundled);
    let content = b"managed";
    let selection = RuntimeSelection {
        version: "2.0.0".to_string(),
        protocol_version: PROTOCOL_VERSION.to_string(),
        sha256: format!("{:x}", Sha256::digest(content)),
        signature: DECODED_SIGNATURE.to_string(),
    };
    let binary = manager.binary_path(&selection.version);
    tokio::fs::create_dir_all(binary.parent().unwrap())
        .await
        .expect("create version");
    tokio::fs::write(&binary, content)
        .await
        .expect("write managed binary");
    manager
        .store_selection(&selection)
        .await
        .expect("store selection");
    assert_eq!(manager.active_binary().await, binary);
    assert_eq!(manager.current_version().await, "2.0.0");

    let lower = RuntimeSelection {
        version: "1.0.0".to_string(),
        ..selection
    };
    let lower_binary = manager.binary_path(&lower.version);
    tokio::fs::create_dir_all(lower_binary.parent().unwrap())
        .await
        .expect("create lower version");
    tokio::fs::write(&lower_binary, content)
        .await
        .expect("write lower binary");
    manager
        .store_selection(&lower)
        .await
        .expect("store lower selection");
    assert_eq!(manager.current_version().await, "1.2.3");

    tokio::fs::write(&bundled, b"#!/bin/sh\necho invalid\n")
        .await
        .expect("write invalid version script");
    assert_eq!(
        manager.bundled_version().await,
        Version::parse(BUNDLED_APP_SERVER_VERSION).unwrap()
    );
    tokio::fs::remove_file(&bundled)
        .await
        .expect("remove bundled");
    assert_eq!(
        manager.bundled_version().await,
        Version::parse(BUNDLED_APP_SERVER_VERSION).unwrap()
    );
    let _ = tokio::fs::remove_dir_all(root).await;
}

#[tokio::test]
async fn check_for_update_handles_http_and_validation_failures() {
    let root = temp_root("http-errors");
    tokio::fs::create_dir_all(&root).await.expect("create root");
    let bundled = root.join("missing-bundled");
    let options = AppServerSpawnOptions::default();

    let url = response_server(vec![http_response("204 No Content", b"")]).await;
    assert!(!test_manager(url, &root, &bundled)
        .check_for_update(&options)
        .await
        .unwrap());

    let url = response_server(vec![http_response("503 Service Unavailable", b"")]).await;
    assert!(matches!(
        test_manager(url, &root, &bundled)
            .check_for_update(&options)
            .await,
        Err(RuntimeUpdateError::ResponseStatus(_))
    ));

    let url = response_server(vec![http_response("200 OK", b"not-json")]).await;
    assert!(matches!(
        test_manager(url, &root, &bundled)
            .check_for_update(&options)
            .await,
        Err(RuntimeUpdateError::Request(_))
    ));

    let invalid = serde_json::to_vec(&serde_json::json!({
        "version": "0.1.0", "protocolVersion": PROTOCOL_VERSION, "url": "https://example.test",
        "sha256": "0".repeat(64), "signature": DECODED_SIGNATURE,
    }))
    .unwrap();
    let url = response_server(vec![http_response("200 OK", &invalid)]).await;
    assert!(matches!(
        test_manager(url, &root, &bundled)
            .check_for_update(&options)
            .await,
        Err(RuntimeUpdateError::NonNewerVersion)
    ));
    let _ = tokio::fs::remove_dir_all(root).await;
}

#[tokio::test]
async fn downloads_update_and_cleans_up_each_install_failure() {
    let root = temp_root("downloads");
    tokio::fs::create_dir_all(&root).await.expect("create root");
    let bundled = root.join("bundled");
    let options = AppServerSpawnOptions::default();
    let content = b"#!/bin/sh\nexit 0\n";

    async fn manager_for_responses(
        root: &Path,
        bundled: &Path,
        content: &[u8],
        download: Vec<u8>,
    ) -> ManagedAppServerRuntime {
        let download_url = response_server(vec![download]).await;
        let update = update_json("99.0.0", &download_url, content);
        let update_url = response_server(vec![http_response("200 OK", &update)]).await;
        test_manager(update_url, root, bundled)
    }

    let manager = manager_for_responses(
        &root,
        &bundled,
        content,
        http_response("500 Internal Server Error", b""),
    )
    .await;
    assert!(matches!(
        manager.check_for_update(&options).await,
        Err(RuntimeUpdateError::Request(_))
    ));

    let mut manager =
        manager_for_responses(&root, &bundled, content, http_response("200 OK", content)).await;
    manager.max_download_bytes = 1;
    assert!(matches!(
        manager.check_for_update(&options).await,
        Err(RuntimeUpdateError::DownloadTooLarge)
    ));

    let chunked = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n4\r\ndata\r\n0\r\n\r\n".to_vec();
    let mut manager = manager_for_responses(&root, &bundled, b"data", chunked).await;
    manager.max_download_bytes = 3;
    assert!(matches!(
        manager.check_for_update(&options).await,
        Err(RuntimeUpdateError::DownloadTooLarge)
    ));

    let manager = manager_for_responses(
        &root,
        &bundled,
        b"different",
        http_response("200 OK", content),
    )
    .await;
    assert!(matches!(
        manager.check_for_update(&options).await,
        Err(RuntimeUpdateError::HashMismatch)
    ));

    let mut manager =
        manager_for_responses(&root, &bundled, content, http_response("200 OK", content)).await;
    manager.verify_release_signature = Arc::new(|_, _| {
        Box::pin(async { Err(RuntimeUpdateError::ReleaseSignature("test".to_string())) })
    });
    assert!(matches!(
        manager.check_for_update(&options).await,
        Err(RuntimeUpdateError::ReleaseSignature(_))
    ));

    let mut manager =
        manager_for_responses(&root, &bundled, content, http_response("200 OK", content)).await;
    manager.verify_signature = Arc::new(|_| Err(RuntimeUpdateError::Signature("test".to_string())));
    assert!(matches!(
        manager.check_for_update(&options).await,
        Err(RuntimeUpdateError::Signature(_))
    ));

    let mut manager =
        manager_for_responses(&root, &bundled, content, http_response("200 OK", content)).await;
    manager.probe_candidate =
        Arc::new(|_, _| Box::pin(async { Err(RuntimeUpdateError::Probe("test".to_string())) }));
    assert!(matches!(
        manager.check_for_update(&options).await,
        Err(RuntimeUpdateError::Probe(_))
    ));

    let manager =
        manager_for_responses(&root, &bundled, content, http_response("200 OK", content)).await;
    assert!(manager
        .check_for_update(&options)
        .await
        .expect("install update"));
    let selection = manager.load_selection().await.expect("selection stored");
    let installed = manager.binary_path(&selection.version);
    assert_eq!(tokio::fs::read(&installed).await.unwrap(), content);
    assert_eq!(manager.active_binary().await, installed);

    let candidate = root.join("second-candidate");
    tokio::fs::write(&candidate, b"old")
        .await
        .expect("write candidate");
    let download_url = response_server(vec![http_response("200 OK", content)]).await;
    let update = RuntimeUpdate {
        version: "99.0.0".to_string(),
        protocol_version: PROTOCOL_VERSION.to_string(),
        url: download_url,
        sha256: format!("{:x}", Sha256::digest(content)),
        signature: DECODED_SIGNATURE.to_string(),
    };
    manager
        .download_verify_and_install(&update, &candidate, &options)
        .await
        .expect("replace installed binary");
    assert!(!tokio::fs::try_exists(&candidate).await.unwrap());
    assert!(!std::fs::read_dir(&root).unwrap().any(|entry| entry
        .unwrap()
        .file_name()
        .to_string_lossy()
        .contains(".download-")));
    let _ = tokio::fs::remove_dir_all(root).await;
}

#[tokio::test]
async fn file_signature_probe_and_io_helpers_cover_error_paths() {
    let root = temp_root("helpers");
    tokio::fs::create_dir_all(&root).await.expect("create root");
    let file = root.join("file");
    tokio::fs::write(&file, b"test").await.expect("write file");
    assert!(matches!(
        verify_release_signature(&file, "invalid").await,
        Err(RuntimeUpdateError::ReleaseSignature(_))
    ));
    assert!(matches!(
        verify_release_signature(&file, DECODED_SIGNATURE).await,
        Err(RuntimeUpdateError::ReleaseSignature(_))
    ));
    assert!(make_executable(&root.join("missing")).await.is_err());
    assert!(matches!(
        probe_candidate(&root.join("missing"), &AppServerSpawnOptions::default()).await,
        Err(RuntimeUpdateError::Probe(_))
    ));

    let production =
        ManagedAppServerRuntime::new("https://example.test/api/v1", root.clone(), file.clone());
    assert!(matches!(
        (production.verify_release_signature)(file.clone(), DECODED_SIGNATURE.to_string()).await,
        Err(RuntimeUpdateError::ReleaseSignature(_))
    ));
    assert!(matches!(
        (production.probe_candidate)(root.join("missing"), AppServerSpawnOptions::default()).await,
        Err(RuntimeUpdateError::Probe(_))
    ));

    let broken_root = root.join("root-file");
    tokio::fs::write(&broken_root, b"file")
        .await
        .expect("write root file");
    let manager = test_manager("https://example.test".to_string(), &broken_root, &file);
    let selection = RuntimeSelection {
        version: "2.0.0".to_string(),
        protocol_version: PROTOCOL_VERSION.to_string(),
        sha256: "0".repeat(64),
        signature: DECODED_SIGNATURE.to_string(),
    };
    assert!(matches!(
        manager.store_selection(&selection).await,
        Err(RuntimeUpdateError::Io(_))
    ));
    let _ = tokio::fs::remove_dir_all(root).await;
}

#[cfg(target_os = "macos")]
#[tokio::test]
async fn macos_platform_signature_checks_codesign_and_identity_details() {
    let path = temp_root("codesign");
    write_executable(&path, b"#!/bin/sh\nexit 0\n").await;
    assert!(matches!(
        verify_platform_signature(&path),
        Err(RuntimeUpdateError::Signature(_))
    ));

    let signed = std::process::Command::new("/usr/bin/codesign")
        .args(["--force", "--sign", "-"])
        .arg(&path)
        .output()
        .expect("run ad hoc codesign");
    assert!(signed.status.success());
    assert!(matches!(
        verify_platform_signature(&path),
        Err(RuntimeUpdateError::Signature(_))
    ));
    assert!(validate_codesign_details(false, "").is_err());
    assert!(validate_codesign_details(true, "Identifier=wrong").is_err());
    assert!(validate_codesign_details(
        true,
        &format!("TeamIdentifier={APP_SERVER_TEAM_ID}\nIdentifier=wrong")
    )
    .is_err());
    validate_codesign_details(
        true,
        &format!("TeamIdentifier={APP_SERVER_TEAM_ID}\nIdentifier={APP_SERVER_SIGNING_IDENTIFIER}"),
    )
    .expect("expected identity details should pass");
    tokio::fs::remove_file(path).await.unwrap();
}

#[cfg(unix)]
#[tokio::test]
async fn probe_candidate_accepts_matching_protocol_and_rejects_mismatch() {
    async fn probe_script(protocol: &str) -> PathBuf {
        let path = temp_root("probe-script");
        let body = format!(
            "#!/bin/sh\nread -r line\nid=$(printf '%s\\n' \"$line\" | sed -n 's/.*\"id\":\\([0-9][0-9]*\\).*/\\1/p')\nprintf '{{\"jsonrpc\":\"2.0\",\"id\":%s,\"result\":{{\"server\":{{\"name\":\"fixture\",\"version\":\"1\",\"protocolVersion\":\"{protocol}\"}},\"transport\":{{\"kind\":\"stdio\",\"encoding\":\"jsonl\"}},\"capabilities\":{{}},\"negotiated\":{{}}}}}}\\n' \"${{id:-1}}\"\nread -r line\nsleep 1\n"
        );
        write_executable(&path, body.as_bytes()).await;
        path
    }

    let matching = probe_script(PROTOCOL_VERSION).await;
    probe_candidate(&matching, &AppServerSpawnOptions::default())
        .await
        .expect("matching probe");
    tokio::fs::remove_file(matching).await.unwrap();

    let mismatch = probe_script("old").await;
    assert!(matches!(
        probe_candidate(&mismatch, &AppServerSpawnOptions::default()).await,
        Err(RuntimeUpdateError::IncompatibleProtocol { .. })
    ));
    tokio::fs::remove_file(mismatch).await.unwrap();

    let invalid = temp_root("invalid-probe");
    write_executable(&invalid, b"#!/bin/sh\nread -r line\necho invalid\n").await;
    assert!(matches!(
        probe_candidate(&invalid, &AppServerSpawnOptions::default()).await,
        Err(RuntimeUpdateError::Probe(_))
    ));
    tokio::fs::remove_file(invalid).await.unwrap();
}
