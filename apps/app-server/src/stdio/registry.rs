use serde_json::Value;
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex as StdMutex, Weak};
use tokio::sync::{Mutex, OwnedMutexGuard};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MethodStability {
    Stable,
    Experimental,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ExecutionPolicy {
    Serial,
    Concurrent,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct MethodSpec {
    pub canonical_name: String,
    pub stability: MethodStability,
    pub mobile_allowed: bool,
    pub execution: ExecutionPolicy,
}

/// The policy record shared by parsing, capability gates, remote transport
/// authorization, and request scheduling. Dotted names remain aliases; slash
/// names are canonical.
pub(crate) fn method_spec(method: &str) -> MethodSpec {
    let legacy_name = legacy_method_name(method);
    MethodSpec {
        canonical_name: legacy_name.replace('.', "/"),
        stability: if legacy_name == "thread.rollback" {
            MethodStability::Experimental
        } else {
            MethodStability::Stable
        },
        mobile_allowed: matches!(
            legacy_name.as_str(),
            "server.ping"
                | "server.describe"
                | "project.list"
                | "project.create"
                | "project.workspace.set"
                | "project.use"
                | "project.clear"
                | "thread.list"
                | "thread.read"
                | "thread.turns.list"
                | "thread.items.list"
                | "thread.children"
                | "thread.status.list"
                | "thread.subscribe"
                | "thread.unsubscribe"
                | "thread.start"
                | "thread.resume"
                | "thread.fork"
                | "thread.archive"
                | "thread.unarchive"
                | "thread.cancel"
                | "thread.delete"
                | "thread.name.set"
                | "turn.start"
                | "turn.steer"
                | "turn.interrupt"
                | "thread.compact"
                | "thread.compact.start"
                | "git.review.status"
                | "git.review.diff"
                | "git.review.stage"
                | "git.review.comment.list"
                | "git.review.comment.add"
                | "git.review.comment.resolve"
                | "git.review.pullRequest.action"
                | "workspace.file.list"
                | "workspace.file.read"
                | "fs.readDirectory"
                | "fs.getMetadata"
                | "serverRequest.list"
                | "diagnostics.submit"
                | "git.branch.list"
                | "git.branch.checkout"
                | "git.branch.create"
                | "git.worktree.list"
                | "git.worktree.create"
                | "git.repository.clone"
                | "github.repository.list"
                | "git.repository.commit"
                | "git.repository.pull"
                | "git.repository.push"
                | "git.pullRequest.create"
                | "remote.event.snapshot"
                | "remote.interaction.respond"
                | "pendingChange.list"
                | "run.status"
                | "run.search"
                | "run.cancel"
        ),
        execution: if matches!(
            legacy_name.as_str(),
            "server.ping"
                | "server.describe"
                | "api.health"
                | "thread.list"
                | "thread.read"
                | "thread.turns.list"
                | "thread.items.list"
                | "thread.children"
                | "thread.status.list"
                | "thread.settings.get"
                | "thread.tokenUsage"
                | "thread.usage"
                | "turn.diff"
                | "thread.diff"
                | "process.list"
                | "process.read"
                | "config.read"
                | "fs.readDirectory"
                | "fs.getMetadata"
                | "serverRequest.list"
                | "mcp.inspect"
                | "mcpServerStatus.list"
                | "mcp.callTool"
                | "mcp.resourceRead"
                | "mcp.reload"
                | "mcp.auth.set"
                | "mcp.auth.clear"
                | "mcp.oauth.start"
                | "mcp.oauth.complete"
                | "mcp.oauth.status"
        ) {
            ExecutionPolicy::Concurrent
        } else {
            ExecutionPolicy::Serial
        },
    }
}

pub(crate) fn legacy_method_name(method: &str) -> String {
    method.trim().replace('/', ".")
}

pub(crate) fn scheduling_key(method: &str, params: &Value) -> String {
    let legacy_name = legacy_method_name(method);
    let (lane, entity) = if legacy_name.starts_with("thread.") || legacy_name.starts_with("turn.") {
        ("thread", params.get("threadId").and_then(Value::as_str))
    } else if legacy_name.starts_with("run.") {
        ("run", params.get("runId").and_then(Value::as_str))
    } else if legacy_name.starts_with("process.") || legacy_name.starts_with("pty.") {
        ("process", params.get("processId").and_then(Value::as_str))
    } else if legacy_name.starts_with("mcp.") {
        ("mcp", params.get("name").and_then(Value::as_str))
    } else {
        (legacy_name.as_str(), None)
    };
    entity
        .map(|entity| format!("{lane}:{entity}"))
        .unwrap_or(legacy_name)
}

#[derive(Debug, Clone, Default)]
pub(crate) struct RequestScheduler {
    lanes: Arc<StdMutex<BTreeMap<String, Weak<Mutex<()>>>>>,
}

impl RequestScheduler {
    pub(crate) async fn acquire(&self, key: String) -> OwnedMutexGuard<()> {
        let lane = {
            let mut lanes = self
                .lanes
                .lock()
                .expect("request scheduler lock should not be poisoned");
            lanes.retain(|_, lane| lane.strong_count() > 0);
            lanes.get(&key).and_then(Weak::upgrade).unwrap_or_else(|| {
                let lane = Arc::new(Mutex::new(()));
                lanes.insert(key, Arc::downgrade(&lane));
                lane
            })
        };
        lane.lock_owned().await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn registry_normalizes_aliases_and_centralizes_policy() {
        let dotted = method_spec("thread.rollback");
        let slashed = method_spec("thread/rollback");
        assert_eq!(dotted, slashed);
        assert_eq!(dotted.canonical_name, "thread/rollback");
        assert_eq!(dotted.stability, MethodStability::Experimental);
        assert_eq!(
            method_spec("mcpServerStatus/list").execution,
            ExecutionPolicy::Concurrent
        );
        assert!(method_spec("workspace.file.read").mobile_allowed);
        assert!(method_spec("git.review.stage").mobile_allowed);
        assert!(method_spec("git.worktree.create").mobile_allowed);
        assert!(method_spec("git.repository.commit").mobile_allowed);
        assert!(method_spec("git.pullRequest.create").mobile_allowed);
        assert_eq!(
            scheduling_key("mcp/inspect", &json!({"name": "github"})),
            "mcp:github"
        );
    }

    #[tokio::test]
    async fn scheduler_serializes_matching_keys_without_blocking_other_keys() {
        let scheduler = RequestScheduler::default();
        let first = scheduler.acquire("thread:one".to_string()).await;
        let same_key = tokio::time::timeout(
            std::time::Duration::from_millis(10),
            scheduler.acquire("thread:one".to_string()),
        )
        .await;
        assert!(same_key.is_err());
        let different_key = tokio::time::timeout(
            std::time::Duration::from_millis(10),
            scheduler.acquire("thread:two".to_string()),
        )
        .await;
        assert!(different_key.is_ok());
        drop(first);
        assert!(tokio::time::timeout(
            std::time::Duration::from_millis(10),
            scheduler.acquire("thread:one".to_string()),
        )
        .await
        .is_ok());
    }
}
