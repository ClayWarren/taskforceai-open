use serde_json::Value;

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

    if let Some(app) = config.get("app") {
        assert!(app.get("windows").is_some() || app.get("security").is_some());
    }
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

#[cfg(coverage)]
#[test]
fn app_run_is_noop_during_coverage() {
    crate::app::run();
}
