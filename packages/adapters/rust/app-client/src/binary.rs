use std::path::PathBuf;

pub fn default_app_server_binary() -> PathBuf {
    if let Some(path) = std::env::var_os("TASKFORCEAI_APP_SERVER") {
        return PathBuf::from(path);
    }
    if let Some(sibling) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join(app_server_binary_name())))
        .filter(|path| path.exists())
    {
        return sibling;
    }
    // This dev fallback is resolved relative to the crate that built the client.
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../../apps/app-server/target/debug")
        .join(app_server_binary_name())
}

#[cfg(windows)]
fn app_server_binary_name() -> &'static str {
    "taskforceai-app-server.exe"
}

#[cfg(not(windows))]
fn app_server_binary_name() -> &'static str {
    "taskforceai-app-server"
}
