use super::*;
use std::time::{SystemTime, UNIX_EPOCH};

fn unique_workspace() -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos();
    let path = std::env::temp_dir().join(format!(
        "taskforceai-desktop-browser-test-{}-{timestamp}",
        std::process::id()
    ));
    std::fs::create_dir_all(&path).expect("create test workspace");
    path.canonicalize().expect("canonical workspace")
}

#[test]
fn normalizes_public_and_localhost_urls() {
    let workspace = unique_workspace();

    let public_url =
        normalize_browser_preview_url("example.com/path", &workspace).expect("public URL");
    assert_eq!(public_url.as_str(), "https://example.com/path");

    let local_url = normalize_browser_preview_url("localhost:3000", &workspace).expect("local URL");
    assert_eq!(local_url.as_str(), "http://localhost:3000/");
}

#[test]
fn rejects_privileged_and_inline_schemes() {
    let workspace = unique_workspace();

    for input in [
        "tauri://localhost/index.html",
        "asset://localhost/index.html",
        "javascript:alert(1)",
        "data:text/html,hi",
    ] {
        let error = normalize_browser_preview_url(input, &workspace)
            .expect_err("scheme should be rejected");
        assert!(
            error.contains("Browser preview only supports")
                || error.contains("Invalid browser URL")
        );
    }
}

#[test]
fn rejects_url_credentials() {
    let workspace = unique_workspace();

    let error = normalize_browser_preview_url("https://user:pass@example.com", &workspace)
        .expect_err("credentials should be rejected");
    assert!(error.contains("credentials"));
}

#[test]
fn uses_fixed_browser_history_scripts() {
    assert_eq!(BROWSER_PREVIEW_BACK_SCRIPT, "window.history.back();");
    assert_eq!(BROWSER_PREVIEW_FORWARD_SCRIPT, "window.history.forward();");
}

#[test]
fn browser_action_scripts_are_generated_from_typed_actions() {
    let click = DesktopBrowserActionParams {
        action: "click".to_string(),
        selector: Some("#submit".to_string()),
        x: None,
        y: None,
        text: None,
        key: None,
        delta_x: None,
        delta_y: None,
        duration_ms: None,
        mode: None,
    };
    let script = browser_action_script(&click).expect("click script");
    assert!(script.contains("\"action\":\"click\""));
    assert!(script.contains("querySelector(params.selector)"));
    assert!(!script.contains("params.script"));

    let select = DesktopBrowserActionParams {
        action: "selectArea".to_string(),
        selector: None,
        x: None,
        y: None,
        text: None,
        key: None,
        delta_x: None,
        delta_y: None,
        duration_ms: None,
        mode: Some("area".to_string()),
    };
    let select_script = browser_action_script(&select).expect("selection script");
    assert!(select_script.contains("Drag to select a Browser preview area"));
}

#[test]
fn rejects_unsupported_browser_actions() {
    let action = DesktopBrowserActionParams {
        action: "eval".to_string(),
        selector: None,
        x: None,
        y: None,
        text: None,
        key: None,
        delta_x: None,
        delta_y: None,
        duration_ms: None,
        mode: None,
    };
    let error = browser_action_script(&action).expect_err("unsupported action");
    assert!(error.contains("Unsupported browser preview action"));
}

#[test]
fn browser_inspect_limits_text_and_element_volume() {
    let script = browser_inspect_script(&DesktopBrowserInspectParams {
        selector: Some("button".to_string()),
        max_text_bytes: Some(usize::MAX),
        max_elements: Some(usize::MAX),
    })
    .expect("inspect script");
    assert!(script.contains("\"maxTextBytes\":32768"));
    assert!(script.contains("\"maxElements\":60"));
}

#[test]
fn browser_annotation_scripts_render_overlay_layer() {
    let script = browser_annotations_script(&DesktopBrowserAnnotationsParams {
        annotations: vec![DesktopBrowserAnnotation {
            id: "comment-1".to_string(),
            text: "Button overlaps the chart.".to_string(),
            target: Some("CTA".to_string()),
            x: Some(12.0),
            y: Some(24.0),
            width: Some(120.0),
            height: Some(44.0),
            kind: Some("area".to_string()),
        }],
    })
    .expect("annotation script");
    assert!(script.contains("__taskforceai_browser_annotations__"));
    assert!(script.contains("Button overlaps the chart."));
}

#[test]
fn browser_init_script_installs_diagnostics_without_tauri_globals() {
    assert!(BROWSER_PREVIEW_INIT_SCRIPT.contains("__TASKFORCEAI_BROWSER_PREVIEW__"));
    assert!(BROWSER_PREVIEW_INIT_SCRIPT.contains("window.fetch"));
    assert!(BROWSER_PREVIEW_INIT_SCRIPT.contains("XMLHttpRequest"));
    assert!(BROWSER_PREVIEW_INIT_SCRIPT.contains("delete window.__TAURI__"));
    assert!(BROWSER_PREVIEW_INIT_SCRIPT.contains("delete window.__TAURI_IPC__"));
}

#[test]
fn browser_diagnostics_scripts_are_fixed_helpers() {
    assert!(BROWSER_DIAGNOSTICS_SCRIPT.contains("getDiagnostics"));
    assert!(BROWSER_DIAGNOSTICS_SCRIPT.contains("sanitizeDiagnostics"));
    assert!(BROWSER_DIAGNOSTICS_SCRIPT.contains("MAX_DIAGNOSTIC_ENTRIES"));
    assert!(BROWSER_DIAGNOSTICS_SCRIPT.contains("MAX_DIAGNOSTIC_URL"));
    assert!(!BROWSER_DIAGNOSTICS_SCRIPT.contains("return helper.getDiagnostics()"));
    assert!(BROWSER_PREVIEW_INIT_SCRIPT.contains("Object.freeze"));
    assert!(BROWSER_PREVIEW_INIT_SCRIPT.contains("configurable: false"));
    assert!(BROWSER_PREVIEW_INIT_SCRIPT.contains("writable: false"));
    assert!(BROWSER_PREVIEW_INIT_SCRIPT.contains("safeUrl(input?.url"));
    assert!(BROWSER_PREVIEW_INIT_SCRIPT.contains("safeTitle(document.title"));
    assert!(BROWSER_DIAGNOSTICS_CLEAR_SCRIPT.contains("clearDiagnostics"));
    assert!(!BROWSER_DIAGNOSTICS_SCRIPT.contains("params.script"));
    assert!(!BROWSER_DIAGNOSTICS_CLEAR_SCRIPT.contains("params.script"));
}

#[test]
fn browser_developer_protocol_is_session_scoped_and_allowlisted() {
    let script = browser_developer_command_script(&DesktopBrowserDeveloperCommandParams {
        session_id: Some("browser-dev-1".to_string()),
        method: "Network.getEntries".to_string(),
        capture_bodies: Some(true),
        max_body_bytes: Some(8_192),
    })
    .expect("developer command script");
    assert!(script.contains("developerCommand"));
    assert!(script.contains("Network.getEntries"));
    assert!(!script.contains("params.script"));
    assert!(BROWSER_PREVIEW_INIT_SCRIPT.contains("cdp-compatible-webview-v1"));
    assert!(BROWSER_PREVIEW_INIT_SCRIPT.contains("PerformanceObserver"));
    assert!(BROWSER_PREVIEW_INIT_SCRIPT.contains("response.clone().text()"));

    let error = browser_developer_command_script(&DesktopBrowserDeveloperCommandParams {
        session_id: Some("browser-dev-1".to_string()),
        method: "Runtime.evaluate".to_string(),
        capture_bodies: None,
        max_body_bytes: None,
    })
    .expect_err("arbitrary CDP execution must stay blocked");
    assert!(error.contains("Unsupported"));
}

#[test]
fn browser_eval_json_rejects_oversized_callback_payloads() {
    let oversized_payload = format!("\"{}\"", "x".repeat(64));
    let error = decode_browser_preview_json::<serde_json::Value>(
        &oversized_payload,
        32,
        "collect browser diagnostics",
    )
    .expect_err("oversized payload should be rejected before deserialize");
    assert!(error.contains("too large"));

    let decoded = decode_browser_preview_json::<serde_json::Value>(
        "{\"ok\":true}",
        MAX_BROWSER_EVAL_RESPONSE_BYTES,
        "collect browser diagnostics",
    )
    .expect("small payload should decode");
    assert_eq!(decoded["ok"], true);
}

#[test]
fn allows_only_the_browser_preview_start_page_from_app_origin() {
    let workspace = unique_workspace();
    let start_page =
        Url::parse("tauri://localhost/desktop-browser-start.html").expect("start page URL");
    browser_preview_navigation_allowed(&start_page, &workspace).expect("start page allowed");

    let other_app_page = Url::parse("tauri://localhost/index.html").expect("app page URL");
    let error = browser_preview_navigation_allowed(&other_app_page, &workspace)
        .expect_err("other app pages should be blocked");
    assert!(error.contains("Browser preview only supports"));
}

#[test]
fn allows_workspace_file_previews() {
    let workspace = unique_workspace();
    let file_path = workspace.join("preview.html");
    std::fs::write(&file_path, "<h1>Preview</h1>").expect("write preview");

    let url = normalize_browser_preview_url("preview.html", &workspace).expect("file URL");
    assert_eq!(url.scheme(), "file");
    browser_preview_url_allowed(&url, &workspace).expect("workspace file allowed");
}

#[test]
fn rejects_file_previews_outside_workspace() {
    let workspace = unique_workspace();
    let outside = std::env::temp_dir().join(format!(
        "taskforceai-desktop-browser-outside-{}.html",
        std::process::id()
    ));
    std::fs::write(&outside, "<h1>Outside</h1>").expect("write outside file");

    let outside_url = Url::from_file_path(outside).expect("outside file URL");
    let error = browser_preview_url_allowed(&outside_url, &workspace)
        .expect_err("outside file should be blocked");
    assert!(error.contains("inside the workspace"));
}

#[test]
fn browser_capture_region_targets_only_child_webview_bounds() {
    let region = BrowserCaptureRegion::new(100.4 + 420.2, 80.1 + 12.0, 639.7, 719.6)
        .expect("capture region");

    assert_eq!(
        region,
        BrowserCaptureRegion {
            x: 521,
            y: 92,
            width: 640,
            height: 720,
        }
    );
    assert_eq!(region.as_screencapture_argument(), "521,92,640,720");
}

#[test]
fn browser_capture_region_rejects_empty_or_non_finite_bounds() {
    assert!(BrowserCaptureRegion::new(0.0, 0.0, 0.0, 100.0).is_err());
    assert!(BrowserCaptureRegion::new(f64::NAN, 0.0, 100.0, 100.0).is_err());
}
