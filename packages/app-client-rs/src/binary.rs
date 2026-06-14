use std::path::PathBuf;

pub fn default_app_server_binary() -> PathBuf {
    if let Some(path) = std::env::var_os("TASKFORCEAI_APP_SERVER") {
        return PathBuf::from(path);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let sibling = dir.join(app_server_binary_name());
            if sibling.exists() {
                return sibling;
            }
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/app-server/target/debug/taskforceai-app-server")
}

fn app_server_binary_name() -> &'static str {
    if cfg!(windows) {
        "taskforceai-app-server.exe"
    } else {
        "taskforceai-app-server"
    }
}
