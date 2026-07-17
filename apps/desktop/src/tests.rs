use serde_json::Value;
use std::io::Cursor;

#[test]
fn tauri_config_matches_branding() {
    let config: Value =
        serde_json::from_str(include_str!("../tauri.conf.json")).expect("parse tauri.conf.json");
    let version = config["version"]
        .as_str()
        .expect("version should be a string");
    assert_eq!(config["productName"], "TaskForceAI");
    assert_eq!(version, env!("CARGO_PKG_VERSION"));
    assert_eq!(config["identifier"], "com.taskforceai.desktop");
}

#[test]
fn tauri_config_has_required_fields() {
    let config: Value =
        serde_json::from_str(include_str!("../tauri.conf.json")).expect("parse tauri.conf.json");

    assert!(config.get("productName").is_some());
    assert!(config.get("version").is_some());
    assert!(config.get("identifier").is_some());
    assert!(config.get("build").is_some());
    assert!(config.get("app").is_some());
}

#[test]
fn tauri_config_window_settings_exist() {
    let config: Value =
        serde_json::from_str(include_str!("../tauri.conf.json")).expect("parse tauri.conf.json");

    let window = &config["app"]["windows"][0];
    assert_eq!(window["titleBarStyle"], "Overlay");
    assert_eq!(window["hiddenTitle"], true);
    assert_eq!(window["theme"], "Dark");
    assert_eq!(window["decorations"], true);
}

#[test]
fn config_version_format_is_valid() {
    let config: Value =
        serde_json::from_str(include_str!("../tauri.conf.json")).expect("parse tauri.conf.json");

    let version = config["version"]
        .as_str()
        .expect("version should be a string");
    let parts: Vec<&str> = version.split('.').collect();
    assert_eq!(
        parts.len(),
        3,
        "Version should follow semver format (X.Y.Z)"
    );

    for part in parts {
        part.parse::<u32>()
            .expect("Version part should be a number");
    }
}

#[test]
fn config_has_build_configuration() {
    let config: Value =
        serde_json::from_str(include_str!("../tauri.conf.json")).expect("parse tauri.conf.json");

    let build = config
        .get("build")
        .expect("build configuration should be present");

    if let Some(dev_url) = build.get("devUrl") {
        let url_str = dev_url.as_str().expect("devUrl should be string");
        assert!(
            url_str.contains("localhost:3210"),
            "Should use the web dev server"
        );
    }
}

#[test]
fn config_packages_desktop_frontend_assets() {
    let config: Value =
        serde_json::from_str(include_str!("../tauri.conf.json")).expect("parse tauri.conf.json");

    let build = config
        .get("build")
        .expect("build configuration should be present");

    assert_eq!(
        build["frontendDist"], "dist_web/client",
        "Desktop release bundles must include the built web client"
    );
}

#[test]
fn macos_entitlements_support_direct_distribution_updates() {
    let config: Value =
        serde_json::from_str(include_str!("../tauri.conf.json")).expect("parse tauri.conf.json");
    assert_eq!(
        config["bundle"]["macOS"]["entitlements"], "macos/entitlements.plist",
        "macOS desktop builds must use the checked entitlement policy"
    );

    let entitlements =
        plist::Value::from_reader_xml(Cursor::new(include_bytes!("../macos/entitlements.plist")))
            .expect("parse macOS entitlements plist");
    let entitlements = entitlements
        .as_dictionary()
        .expect("macOS entitlements should be a plist dictionary");

    assert!(
        entitlements.get("com.apple.security.app-sandbox").is_none(),
        "direct-distribution desktop builds must not enable App Sandbox; the Tauri updater needs to replace the app bundle in /Applications"
    );
    assert_entitlement(
        entitlements,
        "com.apple.security.files.user-selected.read-write",
        true,
    );
    assert_entitlement(entitlements, "com.apple.security.network.client", true);
    assert_entitlement(entitlements, "com.apple.security.network.server", true);
    assert_entitlement(entitlements, "com.apple.security.device.audio-input", true);
}

#[test]
fn capabilities_keep_browser_preview_without_ipc_permissions() {
    for (name, raw) in [
        ("default", include_str!("../capabilities/default.json")),
        ("main", include_str!("../capabilities/main.json")),
    ] {
        let capability: Value = serde_json::from_str(raw).expect("parse capability");
        let webviews = capability["webviews"]
            .as_array()
            .unwrap_or_else(|| panic!("{name} capability must pin explicit webviews"));

        assert!(
            webviews
                .iter()
                .all(|webview| webview.as_str() == Some("main")),
            "{name} capability must stay scoped to the main app webview"
        );
        assert!(
            capability.get("windows").is_none(),
            "{name} capability must not authorize every webview in the main window"
        );
        assert!(
            capability.get("remote").is_none(),
            "{name} capability must not authorize remote origins"
        );
    }
}

#[test]
fn main_capability_allows_window_dragging() {
    let capability: Value = serde_json::from_str(include_str!("../capabilities/main.json"))
        .expect("parse main capability");
    let permissions = capability["permissions"]
        .as_array()
        .expect("main capability permissions should be an array");

    assert!(
        permissions
            .iter()
            .any(|permission| permission == "core:window:allow-start-dragging"),
        "the desktop drag region requires the explicit Tauri start-dragging permission"
    );
}

fn assert_entitlement(entitlements: &plist::Dictionary, key: &str, expected: bool) {
    let actual = entitlements
        .get(key)
        .and_then(plist::Value::as_boolean)
        .unwrap_or_else(|| panic!("{key} should be present as a boolean entitlement"));
    assert_eq!(actual, expected, "{key} entitlement mismatch");
}

#[cfg(coverage)]
#[test]
fn app_run_is_noop_during_coverage() {
    crate::app::run();
}
