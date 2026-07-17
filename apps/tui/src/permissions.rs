use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use taskforceai_app_protocol::{
    CommandApprovalParams, FileChangeApprovalParams, JsonRpcServerRequest, PermissionApprovalParams,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum RuleDecision {
    Allow,
    Ask,
    Deny,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ApprovalTarget {
    pub kind: String,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PermissionRule {
    kind: String,
    pattern: String,
    decision: RuleDecision,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PermissionConfig {
    #[serde(default)]
    rules: Vec<PermissionRule>,
}

pub(crate) fn approval_target(request: &JsonRpcServerRequest) -> Option<ApprovalTarget> {
    match request.method.as_str() {
        "item/commandExecution/requestApproval" => {
            let params: CommandApprovalParams =
                serde_json::from_value(request.params.clone()).ok()?;
            Some(ApprovalTarget {
                kind: "command".to_string(),
                value: params
                    .command
                    .as_ref()
                    .map(format_command)
                    .unwrap_or_else(|| "unknown command".to_string()),
            })
        }
        "item/fileChange/requestApproval" => {
            let params: FileChangeApprovalParams =
                serde_json::from_value(request.params.clone()).ok()?;
            let value = params
                .changes
                .iter()
                .filter_map(change_path)
                .collect::<Vec<_>>()
                .join(" ");
            Some(ApprovalTarget {
                kind: "file".to_string(),
                value: if value.is_empty() {
                    params
                        .changes
                        .iter()
                        .map(format_value)
                        .collect::<Vec<_>>()
                        .join(" ")
                } else {
                    value
                },
            })
        }
        "item/permissions/requestApproval" => {
            let params: PermissionApprovalParams =
                serde_json::from_value(request.params.clone()).ok()?;
            Some(ApprovalTarget {
                kind: "permission".to_string(),
                value: format_value(&params.permissions),
            })
        }
        _ => None,
    }
}

pub(crate) async fn decision_for_request(
    workspace: Option<&str>,
    request: &JsonRpcServerRequest,
) -> Option<RuleDecision> {
    let target = approval_target(request)?;
    let user_path = user_config_path();
    let project_path = workspace.map(project_config_path);
    decision_for_paths(&target, user_path.as_deref(), project_path.as_deref()).await
}

async fn decision_for_paths(
    target: &ApprovalTarget,
    user_path: Option<&Path>,
    project_path: Option<&Path>,
) -> Option<RuleDecision> {
    let user_config = match user_path {
        Some(path) => load_config(path).await,
        None => PermissionConfig::default(),
    };
    let project_config = match project_path {
        Some(path) => Some(load_config(path).await),
        None => None,
    };
    decision_for_configs(target, &user_config, project_config.as_ref())
}

pub(crate) async fn persist_default_rule(
    workspace: Option<&str>,
    target: &ApprovalTarget,
    decision: RuleDecision,
) -> Result<PathBuf, String> {
    let path = default_config_path(workspace, decision)?;
    let mut config = load_config(&path).await;
    config
        .rules
        .retain(|rule| rule.kind != target.kind || rule.pattern != target.value);
    config.rules.push(PermissionRule {
        kind: target.kind.clone(),
        pattern: target.value.clone(),
        decision,
    });
    save_config(&path, &config).await?;
    Ok(path)
}

pub(crate) async fn handle_command(
    workspace: Option<&str>,
    args: &[&str],
) -> Result<String, String> {
    let action = args.first().copied().unwrap_or("list");
    if action == "list" || action == "status" {
        return list_rules(workspace).await;
    }
    if action == "clear" {
        let scope = args
            .get(1)
            .copied()
            .unwrap_or_else(|| default_scope(workspace));
        let path = scoped_config_path(workspace, scope)?;
        save_config(&path, &PermissionConfig::default()).await?;
        return Ok(format!("Cleared permission rules in {}.", path.display()));
    }
    let decision = match action {
        "allow" => RuleDecision::Allow,
        "ask" => RuleDecision::Ask,
        "deny" => RuleDecision::Deny,
        _ => {
            return Ok(
                "Usage: /permissions [list|allow <kind> <pattern> [project|user]|ask ...|deny ...|clear [project|user]]"
                    .to_string(),
            )
        }
    };
    let kind = args
        .get(1)
        .copied()
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !matches!(kind.as_str(), "all" | "command" | "file" | "permission") {
        return Err("Permission kind must be all, command, file, or permission.".to_string());
    }
    let (pattern_parts, scope) = match args.last().copied() {
        Some("project" | "user") if args.len() > 3 => {
            (&args[2..args.len() - 1], args[args.len() - 1])
        }
        _ => (&args[2..], default_rule_scope(workspace, decision)),
    };
    let pattern = pattern_parts.join(" ");
    if pattern.trim().is_empty() {
        return Err("A non-empty permission pattern is required.".to_string());
    }
    if decision == RuleDecision::Allow && scope == "project" {
        return Err(
            "Project permission files cannot auto-approve requests; save allow rules in user scope."
                .to_string(),
        );
    }
    let path = scoped_config_path(workspace, scope)?;
    let mut config = load_config(&path).await;
    config
        .rules
        .retain(|rule| rule.kind != kind || rule.pattern != pattern);
    config.rules.push(PermissionRule {
        kind: kind.clone(),
        pattern: pattern.clone(),
        decision,
    });
    save_config(&path, &config).await?;
    Ok(format!(
        "Saved {action} rule for {kind} `{pattern}` in {}.",
        path.display()
    ))
}

fn default_scope(workspace: Option<&str>) -> &'static str {
    if workspace.is_some() {
        "project"
    } else {
        "user"
    }
}

fn default_rule_scope(workspace: Option<&str>, decision: RuleDecision) -> &'static str {
    if decision == RuleDecision::Allow {
        "user"
    } else {
        default_scope(workspace)
    }
}

async fn list_rules(workspace: Option<&str>) -> Result<String, String> {
    let mut lines = Vec::new();
    let project_path = workspace.map(project_config_path);
    for path in config_paths(workspace) {
        let config = load_config(&path).await;
        if config.rules.is_empty() {
            continue;
        }
        lines.push(path.display().to_string());
        lines.extend(config.rules.into_iter().map(|rule| {
            if project_path.as_ref() == Some(&path) && rule.decision == RuleDecision::Allow {
                format!(
                    "- Allow {} {} (ignored; allow rules require user scope)",
                    rule.kind, rule.pattern
                )
            } else {
                format!("- {:?} {} {}", rule.decision, rule.kind, rule.pattern)
            }
        }));
    }
    if lines.is_empty() {
        Ok("No persistent permission rules. Add one with /permissions allow|ask|deny <kind> <pattern> [project|user].".to_string())
    } else {
        Ok(lines.join("\n"))
    }
}

fn config_paths(workspace: Option<&str>) -> Vec<PathBuf> {
    let mut paths = user_config_path().into_iter().collect::<Vec<_>>();
    if let Some(workspace) = workspace {
        paths.push(project_config_path(workspace));
    }
    paths
}

fn default_config_path(workspace: Option<&str>, decision: RuleDecision) -> Result<PathBuf, String> {
    if decision == RuleDecision::Allow {
        return user_config_path()
            .ok_or_else(|| "Cannot determine the user permission config directory.".to_string());
    }
    workspace
        .map(project_config_path)
        .or_else(user_config_path)
        .ok_or_else(|| "Cannot determine a permission config directory.".to_string())
}

fn scoped_config_path(workspace: Option<&str>, scope: &str) -> Result<PathBuf, String> {
    match scope {
        "project" => workspace
            .map(project_config_path)
            .ok_or_else(|| "Project permission rules require Work or Code mode.".to_string()),
        "user" => user_config_path()
            .ok_or_else(|| "Cannot determine the user permission config directory.".to_string()),
        _ => Err("Permission scope must be project or user.".to_string()),
    }
}

fn project_config_path(workspace: &str) -> PathBuf {
    Path::new(workspace).join(".taskforceai/permissions.json")
}

fn user_config_path() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .map(|home| home.join(".config/taskforceai/permissions.json"))
}

async fn load_config(path: &Path) -> PermissionConfig {
    let Ok(contents) = tokio::fs::read_to_string(path).await else {
        return PermissionConfig::default();
    };
    serde_json::from_str(&contents).unwrap_or_default()
}

async fn save_config(path: &Path, config: &PermissionConfig) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|error| format!("create permission directory: {error}"))?;
    }
    let contents = serde_json::to_string_pretty(config)
        .map_err(|error| format!("encode permission rules: {error}"))?;
    tokio::fs::write(path, format!("{contents}\n"))
        .await
        .map_err(|error| format!("write permission rules: {error}"))
}

fn decision_for_configs(
    target: &ApprovalTarget,
    user_config: &PermissionConfig,
    project_config: Option<&PermissionConfig>,
) -> Option<RuleDecision> {
    let mut matched = None;
    apply_matching_rules(target, user_config, true, &mut matched);
    if let Some(project_config) = project_config {
        apply_matching_rules(target, project_config, false, &mut matched);
    }
    matched
}

fn apply_matching_rules(
    target: &ApprovalTarget,
    config: &PermissionConfig,
    allow_auto_approval: bool,
    matched: &mut Option<RuleDecision>,
) {
    for rule in &config.rules {
        if (rule.kind == "all" || rule.kind == target.kind)
            && wildcard_matches(&rule.pattern, &target.value)
            && (allow_auto_approval || rule.decision != RuleDecision::Allow)
        {
            *matched = Some(rule.decision);
        }
    }
}

fn wildcard_matches(pattern: &str, value: &str) -> bool {
    let pattern = pattern.to_ascii_lowercase();
    let value = value.to_ascii_lowercase();
    let parts = pattern.split('*').collect::<Vec<_>>();
    if parts.len() == 1 {
        return pattern == value;
    }
    let mut cursor = 0_usize;
    for (index, part) in parts.iter().enumerate() {
        if part.is_empty() {
            continue;
        }
        let Some(relative) = value[cursor..].find(part) else {
            return false;
        };
        if index == 0 && !pattern.starts_with('*') && relative != 0 {
            return false;
        }
        cursor += relative + part.len();
    }
    pattern.ends_with('*') || parts.last().is_some_and(|part| value.ends_with(part))
}

fn change_path(value: &Value) -> Option<String> {
    value
        .get("path")
        .or_else(|| value.get("filePath"))
        .or_else(|| value.get("file"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

fn format_value(value: &Value) -> String {
    value
        .as_str()
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| serde_json::to_string(value).unwrap_or_else(|_| value.to_string()))
}

fn format_command(value: &Value) -> String {
    match value {
        Value::String(command) => command.clone(),
        Value::Array(arguments) if arguments.iter().all(|argument| argument.as_str().is_some()) => {
            arguments
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join(" ")
        }
        Value::Object(command) => command
            .get("command")
            .or_else(|| command.get("argv"))
            .map(format_command)
            .unwrap_or_else(|| format_value(value)),
        _ => format_value(value),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use taskforceai_app_protocol::{JsonRpcServerRequest, JSONRPC_VERSION};

    use super::*;

    fn request(method: &str, params: Value) -> JsonRpcServerRequest {
        JsonRpcServerRequest {
            jsonrpc: JSONRPC_VERSION.to_string(),
            id: json!(1),
            method: method.to_string(),
            params,
        }
    }

    #[test]
    fn wildcard_rules_are_anchored_unless_starred() {
        assert!(wildcard_matches("cargo test*", "cargo test --all"));
        assert!(!wildcard_matches("cargo test*", "sudo cargo test"));
        assert!(wildcard_matches("*README.md", "/repo/README.md"));
        assert!(wildcard_matches("exact", "EXACT"));
        assert!(!wildcard_matches("a*b", "ac"));
        assert!(!wildcard_matches("a*b", "za-b"));
        assert!(wildcard_matches("*", "anything"));
    }

    #[test]
    fn approval_targets_cover_commands_files_permissions_and_invalid_requests() {
        let command = approval_target(&request(
            "item/commandExecution/requestApproval",
            json!({
                "threadId":"t", "turnId":"u", "itemId":"i",
                "command":["cargo", "test"]
            }),
        ))
        .expect("command target");
        assert_eq!(command.value, "cargo test");

        let unknown = approval_target(&request(
            "item/commandExecution/requestApproval",
            json!({"threadId":"t", "turnId":"u", "itemId":"i"}),
        ))
        .expect("unknown command target");
        assert_eq!(unknown.value, "unknown command");

        let files = approval_target(&request(
            "item/fileChange/requestApproval",
            json!({
                "threadId":"t", "turnId":"u", "itemId":"i",
                "changes":[{"path":"a.rs"},{"filePath":"b.rs"},{"file":"c.rs"}]
            }),
        ))
        .expect("file target");
        assert_eq!(files.value, "a.rs b.rs c.rs");

        let fallback = approval_target(&request(
            "item/fileChange/requestApproval",
            json!({
                "threadId":"t", "turnId":"u", "itemId":"i",
                "changes":[{"kind":"create"}]
            }),
        ))
        .expect("file fallback");
        assert!(fallback.value.contains("create"));

        let permission = approval_target(&request(
            "item/permissions/requestApproval",
            json!({
                "threadId":"t", "turnId":"u", "itemId":"i",
                "permissions":{"network":true}
            }),
        ))
        .expect("permission target");
        assert!(permission.value.contains("network"));
        assert!(approval_target(&request("unknown", json!({}))).is_none());
        assert!(approval_target(&request("item/fileChange/requestApproval", json!({}))).is_none());

        assert_eq!(format_command(&json!({"command":"bun test"})), "bun test");
        assert_eq!(format_command(&json!({"argv":["bun", "test"]})), "bun test");
        assert!(format_command(&json!({"other":true})).contains("other"));
        assert_eq!(format_value(&json!("plain")), "plain");
    }

    #[tokio::test]
    async fn permission_configs_persist_and_reload_rules() {
        let root = tempfile::tempdir().expect("tempdir");
        let path = root.path().join("permissions.json");
        let config = PermissionConfig {
            rules: vec![PermissionRule {
                kind: "command".to_string(),
                pattern: "cargo test*".to_string(),
                decision: RuleDecision::Allow,
            }],
        };

        save_config(&path, &config).await.expect("save rules");
        let loaded = load_config(&path).await;

        assert_eq!(loaded.rules, config.rules);
    }

    #[test]
    fn project_allow_rules_cannot_approve_requests() {
        let target = ApprovalTarget {
            kind: "command".to_string(),
            value: "rm -rf important".to_string(),
        };
        let user_deny = PermissionConfig {
            rules: vec![PermissionRule {
                kind: "all".to_string(),
                pattern: "*".to_string(),
                decision: RuleDecision::Deny,
            }],
        };
        let project_config = PermissionConfig {
            rules: vec![PermissionRule {
                kind: "all".to_string(),
                pattern: "*".to_string(),
                decision: RuleDecision::Allow,
            }],
        };

        assert_eq!(
            decision_for_configs(&target, &PermissionConfig::default(), Some(&project_config)),
            None
        );
        assert_eq!(
            decision_for_configs(&target, &user_deny, Some(&project_config)),
            Some(RuleDecision::Deny)
        );
        assert_eq!(
            default_rule_scope(Some("/untrusted/repository"), RuleDecision::Allow),
            "user"
        );
    }

    #[tokio::test]
    async fn repository_permission_file_cannot_approve_requests() {
        let workspace = tempfile::tempdir().expect("tempdir");
        let project_path = project_config_path(workspace.path().to_str().expect("workspace path"));
        let project_config = PermissionConfig {
            rules: vec![PermissionRule {
                kind: "all".to_string(),
                pattern: "*".to_string(),
                decision: RuleDecision::Allow,
            }],
        };
        save_config(&project_path, &project_config)
            .await
            .expect("malicious project config");
        let target = ApprovalTarget {
            kind: "command".to_string(),
            value: "rm -rf important".to_string(),
        };

        assert_eq!(
            decision_for_paths(&target, None, Some(&project_path)).await,
            None
        );
    }

    #[test]
    fn project_rules_can_only_tighten_user_policy() {
        let target = ApprovalTarget {
            kind: "command".to_string(),
            value: "cargo test".to_string(),
        };
        let user_config = PermissionConfig {
            rules: vec![PermissionRule {
                kind: "command".to_string(),
                pattern: "cargo test".to_string(),
                decision: RuleDecision::Allow,
            }],
        };
        let project_ask = PermissionConfig {
            rules: vec![PermissionRule {
                kind: "all".to_string(),
                pattern: "*".to_string(),
                decision: RuleDecision::Ask,
            }],
        };
        let project_deny = PermissionConfig {
            rules: vec![PermissionRule {
                kind: "all".to_string(),
                pattern: "*".to_string(),
                decision: RuleDecision::Deny,
            }],
        };

        assert_eq!(
            decision_for_configs(&target, &user_config, None),
            Some(RuleDecision::Allow)
        );
        assert_eq!(
            decision_for_configs(&target, &user_config, Some(&project_ask)),
            Some(RuleDecision::Ask)
        );
        assert_eq!(
            decision_for_configs(&target, &user_config, Some(&project_deny)),
            Some(RuleDecision::Deny)
        );
    }

    #[tokio::test]
    async fn project_allow_commands_are_rejected() {
        let workspace = tempfile::tempdir().expect("tempdir");
        let error = handle_command(
            workspace.path().to_str(),
            &["allow", "command", "cargo test*", "project"],
        )
        .await
        .expect_err("project allow must be rejected");

        assert!(error.contains("cannot auto-approve"));
        assert!(!workspace.path().join(".taskforceai").exists());
    }

    #[tokio::test]
    async fn permission_command_workflow_covers_project_rules_and_validation() {
        let workspace = tempfile::tempdir().expect("tempdir");
        let workspace_path = workspace.path().to_str().expect("workspace");

        assert!(handle_command(Some(workspace_path), &["bogus"])
            .await
            .unwrap()
            .contains("Usage"));
        assert!(handle_command(Some(workspace_path), &["ask", "bogus", "*"])
            .await
            .unwrap_err()
            .contains("kind"));
        assert!(handle_command(Some(workspace_path), &["ask", "command"])
            .await
            .unwrap_err()
            .contains("non-empty"));
        let saved = handle_command(
            Some(workspace_path),
            &["ask", "command", "cargo test*", "project"],
        )
        .await
        .expect("save project ask");
        assert!(saved.contains("Saved ask rule"));
        let listed = handle_command(Some(workspace_path), &["status"])
            .await
            .expect("list");
        assert!(listed.contains("cargo test*"));

        let target = ApprovalTarget {
            kind: "command".to_string(),
            value: "cargo test --all".to_string(),
        };
        assert_eq!(
            decision_for_paths(&target, None, Some(&project_config_path(workspace_path))).await,
            Some(RuleDecision::Ask)
        );
        assert_eq!(
            decision_for_paths(&target, Some(&project_config_path(workspace_path)), None).await,
            Some(RuleDecision::Ask)
        );
        let approval = request(
            "item/commandExecution/requestApproval",
            json!({
                "threadId":"t", "turnId":"u", "itemId":"i",
                "command":["cargo", "test", "--all"]
            }),
        );
        assert_eq!(
            decision_for_request(Some(workspace_path), &approval).await,
            Some(RuleDecision::Ask)
        );
        persist_default_rule(Some(workspace_path), &target, RuleDecision::Deny)
            .await
            .expect("persist deny");

        let cleared = handle_command(Some(workspace_path), &["clear"])
            .await
            .expect("clear");
        assert!(cleared.contains("Cleared"));
        assert!(handle_command(Some(workspace_path), &["list"])
            .await
            .unwrap()
            .contains("No persistent"));

        assert_eq!(default_scope(Some(workspace_path)), "project");
        assert_eq!(default_scope(None), "user");
        assert_eq!(
            default_rule_scope(Some(workspace_path), RuleDecision::Ask),
            "project"
        );
        assert!(scoped_config_path(None, "project").is_err());
        assert!(scoped_config_path(Some(workspace_path), "invalid").is_err());
        assert!(scoped_config_path(None, "user").is_ok());
        assert!(default_config_path(None, RuleDecision::Allow).is_ok());
        assert_eq!(
            config_paths(Some(workspace_path)).last(),
            Some(&project_config_path(workspace_path))
        );

        let invalid = workspace.path().join("invalid.json");
        tokio::fs::write(&invalid, "not json")
            .await
            .expect("invalid config");
        assert!(load_config(&invalid).await.rules.is_empty());
        assert!(load_config(&workspace.path().join("missing.json"))
            .await
            .rules
            .is_empty());

        let project_allow = PermissionConfig {
            rules: vec![PermissionRule {
                kind: "command".to_string(),
                pattern: "cargo test*".to_string(),
                decision: RuleDecision::Allow,
            }],
        };
        save_config(&project_config_path(workspace_path), &project_allow)
            .await
            .expect("project allow fixture");
        assert!(list_rules(Some(workspace_path))
            .await
            .unwrap()
            .contains("ignored"));
        assert_eq!(format_command(&json!(7)), "7");
    }
}
