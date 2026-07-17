use std::collections::HashSet;
use std::path::PathBuf;

use serde_json::Value;
use taskforceai_app_protocol::{ClientCapabilities, ClientInfo, InitializeParams};

use crate::protocol::OutgoingMessage;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum InitializationPhase {
    New,
    AwaitingInitialized,
    Ready,
}

#[derive(Debug, Clone)]
pub(crate) struct ConnectionState {
    phase: InitializationPhase,
    client_info: Option<ClientInfo>,
    capabilities: ClientCapabilities,
    notification_opt_outs: HashSet<String>,
    thread_subscriptions: HashSet<String>,
    mobile_workspace_roots: HashSet<PathBuf>,
    mobile: bool,
}

impl Default for ConnectionState {
    fn default() -> Self {
        Self {
            phase: InitializationPhase::New,
            client_info: None,
            capabilities: ClientCapabilities::default(),
            notification_opt_outs: HashSet::new(),
            thread_subscriptions: HashSet::new(),
            mobile_workspace_roots: HashSet::new(),
            mobile: false,
        }
    }
}

impl ConnectionState {
    #[cfg(test)]
    pub(crate) fn authenticated_http() -> Self {
        Self {
            phase: InitializationPhase::Ready,
            ..Self::default()
        }
    }

    pub(crate) fn authenticated_mobile(workspace_roots: Vec<PathBuf>) -> Self {
        Self {
            phase: InitializationPhase::Ready,
            mobile_workspace_roots: workspace_roots.into_iter().collect(),
            mobile: true,
            ..Self::default()
        }
    }

    pub(crate) fn allows_mobile_workspace(&self, workspace: &str) -> bool {
        canonical_mobile_path(workspace).is_some_and(|workspace| {
            self.mobile_workspace_roots
                .iter()
                .any(|root| workspace.starts_with(root))
        })
    }

    pub(crate) fn allows_mobile_workspace_path(&self, path: &str) -> bool {
        let path = expand_mobile_path(path);
        let Some(parent) = path.parent().and_then(|parent| parent.canonicalize().ok()) else {
            return false;
        };
        let Some(name) = path.file_name() else {
            return false;
        };
        let candidate = parent.join(name);
        self.mobile_workspace_roots
            .iter()
            .any(|root| candidate.starts_with(root))
    }

    pub(crate) fn allows_mobile_workspace_roots<'a>(
        &self,
        workspace_roots: impl IntoIterator<Item = &'a str>,
    ) -> bool {
        workspace_roots
            .into_iter()
            .all(|workspace| self.allows_mobile_workspace(workspace))
    }

    pub(crate) fn phase(&self) -> InitializationPhase {
        self.phase
    }

    pub(crate) fn begin_initialize(&mut self, params: &InitializeParams) {
        self.phase = InitializationPhase::AwaitingInitialized;
        self.client_info = params.client_info.clone();
        self.capabilities = params.capabilities.clone();
        self.notification_opt_outs = params
            .capabilities
            .opt_out_notification_methods
            .iter()
            .cloned()
            .collect();
    }

    pub(crate) fn finish_initialize(&mut self) {
        self.phase = InitializationPhase::Ready;
    }

    pub(crate) fn suppresses_notification(&self, method: &str) -> bool {
        self.notification_opt_outs.contains(method)
    }

    pub(crate) fn subscribe_thread(&mut self, thread_id: &str) {
        self.thread_subscriptions.insert(thread_id.to_string());
    }

    pub(crate) fn unsubscribe_thread(&mut self, thread_id: &str) {
        self.thread_subscriptions.remove(thread_id);
    }

    pub(crate) fn allows_notification(&self, method: &str, params: &Value) -> bool {
        if self.mobile && matches!(method, "process/outputDelta" | "process/exited") {
            return false;
        }
        if self.suppresses_notification(method) {
            return false;
        }
        if self.thread_subscriptions.is_empty() {
            return true;
        }
        notification_thread_id(params)
            .is_none_or(|thread_id| self.thread_subscriptions.contains(thread_id))
    }

    pub(crate) fn allows_outgoing_message(&self, message: &OutgoingMessage) -> bool {
        match message {
            OutgoingMessage::Notification(notification) => {
                self.allows_notification(&notification.method, &notification.params)
            }
            OutgoingMessage::Request(request) => {
                self.allows_notification(&request.method, &request.params)
            }
            OutgoingMessage::Response(_) => true,
        }
    }

    pub(crate) fn experimental_api(&self) -> bool {
        self.capabilities.experimental_api
    }
}

fn canonical_mobile_path(path: &str) -> Option<PathBuf> {
    let path = path.trim();
    if path.is_empty() {
        return None;
    }
    expand_mobile_path(path).canonicalize().ok()
}

fn expand_mobile_path(path: &str) -> PathBuf {
    let path = path.trim();
    if path == "~" {
        return std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(path));
    }
    if let Some(relative) = path.strip_prefix("~/") {
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home).join(relative);
        }
    }
    PathBuf::from(path)
}

fn notification_thread_id(params: &Value) -> Option<&str> {
    params
        .get("threadId")
        .and_then(Value::as_str)
        .or_else(|| params.get("thread_id").and_then(Value::as_str))
        .or_else(|| {
            params
                .get("thread")
                .and_then(|thread| thread.get("id"))
                .and_then(Value::as_str)
        })
        .or_else(|| {
            params
                .get("context")
                .and_then(|context| context.get("threadId"))
                .and_then(Value::as_str)
        })
        .or_else(|| {
            params
                .get("request")
                .and_then(|request| request.get("params"))
                .and_then(|params| params.get("context"))
                .and_then(|context| context.get("threadId"))
                .and_then(Value::as_str)
        })
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;
    use serde_json::json;

    #[test]
    fn thread_subscriptions_filter_only_thread_scoped_notifications() {
        let mut connection = ConnectionState::authenticated_http();
        connection.subscribe_thread("thread-one");
        assert!(connection.allows_notification("turn/updated", &json!({"threadId": "thread-one"})));
        assert!(!connection.allows_notification("turn/updated", &json!({"threadId": "thread-two"})));
        assert!(connection.allows_notification("mcpServer/startupStatus/updated", &json!({})));
        connection.unsubscribe_thread("thread-one");
        assert!(connection.allows_notification("turn/updated", &json!({"threadId": "thread-two"})));
    }

    #[test]
    fn mobile_connections_cannot_receive_process_notifications() {
        let mobile = ConnectionState::authenticated_mobile(Vec::new());
        let desktop = ConnectionState::authenticated_http();

        for method in ["process/outputDelta", "process/exited"] {
            assert!(!mobile.allows_notification(method, &json!({})));
            assert!(desktop.allows_notification(method, &json!({})));
        }
        assert!(mobile.allows_notification("turn/updated", &json!({"threadId": "thread-one"})));
    }

    #[test]
    fn mobile_workspace_scope_is_canonical_and_contained() {
        let base = std::env::temp_dir().join(format!(
            "taskforceai-mobile-workspace-scope-{}",
            std::process::id()
        ));
        let trusted = base.join("trusted");
        let sibling = base.join("sibling");
        fs::create_dir_all(&trusted).expect("create trusted workspace");
        fs::create_dir_all(&sibling).expect("create sibling workspace");
        let trusted = trusted.canonicalize().expect("canonical trusted workspace");
        let connection = ConnectionState::authenticated_mobile(vec![trusted.clone()]);
        let trusted_display = trusted.display().to_string();

        assert!(connection.allows_mobile_workspace(&trusted_display));
        fs::create_dir_all(trusted.join("nested")).expect("create nested workspace");
        assert!(connection.allows_mobile_workspace(&trusted.join("nested").display().to_string()));
        assert!(connection
            .allows_mobile_workspace_path(&trusted.join("new-worktree").display().to_string()));
        assert!(connection.allows_mobile_workspace_roots([trusted_display.as_str()]));
        assert!(
            !connection.allows_mobile_workspace_path(&sibling.join("clone").display().to_string())
        );
        assert!(!connection.allows_mobile_workspace(&sibling.display().to_string()));
        assert!(!connection.allows_mobile_workspace(&base.display().to_string()));
    }
}
