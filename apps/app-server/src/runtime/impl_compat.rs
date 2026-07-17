use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, UNIX_EPOCH};

use serde_json::Value;
use tokio::sync::mpsc;

use crate::api::ApiClient;
use crate::protocol::*;

use super::error::RuntimeError;
use super::util::{to_value, value};

const THREAD_SETTINGS_METADATA_KEY: &str = "thread_execution_settings_v1";
const RUNTIME_CONFIG_METADATA_KEY: &str = "runtime_config_v1";
const HOOKS_METADATA_KEY: &str = "lifecycle_hooks_v1";

impl super::AppRuntime {
    pub fn thread_settings_get(
        &self,
        params: ThreadSettingsParams,
    ) -> Result<AppResponse, RuntimeError> {
        self.find_thread_record(&params.thread_id)?;
        Ok(value(ThreadSettingsResult {
            settings: self.thread_execution_settings(&params.thread_id)?,
            thread_id: params.thread_id,
        }))
    }

    pub fn thread_settings_update(
        &mut self,
        params: ThreadSettingsUpdateParams,
    ) -> Result<AppResponse, RuntimeError> {
        self.find_thread_record(&params.thread_id)?;
        validate_thread_settings(&params.settings)?;
        let mut settings = self.thread_settings_map()?;
        settings.insert(params.thread_id.clone(), params.settings.clone());
        self.set_metadata_json(THREAD_SETTINGS_METADATA_KEY, &settings)?;
        Ok(value(ThreadSettingsResult {
            thread_id: params.thread_id,
            settings: params.settings,
        }))
    }

    pub(crate) fn save_initial_thread_settings(
        &mut self,
        thread_id: &str,
        settings: Option<ThreadExecutionSettings>,
    ) -> Result<(), RuntimeError> {
        let Some(settings) = settings else {
            return Ok(());
        };
        validate_thread_settings(&settings)?;
        let mut records = self.thread_settings_map()?;
        records.insert(thread_id.to_string(), settings);
        self.set_metadata_json(THREAD_SETTINGS_METADATA_KEY, &records)
    }

    pub(crate) fn thread_execution_settings(
        &self,
        thread_id: &str,
    ) -> Result<ThreadExecutionSettings, RuntimeError> {
        Ok(self
            .thread_settings_map()?
            .remove(thread_id)
            .unwrap_or_default())
    }

    pub(crate) fn persist_turn_settings(
        &mut self,
        thread_id: &str,
        settings: ThreadExecutionSettings,
    ) -> Result<(), RuntimeError> {
        validate_thread_settings(&settings)?;
        let mut records = self.thread_settings_map()?;
        records.insert(thread_id.to_string(), settings);
        self.set_metadata_json(THREAD_SETTINGS_METADATA_KEY, &records)
    }

    pub(crate) fn remove_thread_settings(&mut self, thread_id: &str) -> Result<(), RuntimeError> {
        let mut records = self.thread_settings_map()?;
        records.remove(thread_id);
        self.set_metadata_json(THREAD_SETTINGS_METADATA_KEY, &records)
    }

    fn thread_settings_map(
        &self,
    ) -> Result<BTreeMap<String, ThreadExecutionSettings>, RuntimeError> {
        Ok(self
            .metadata_json(THREAD_SETTINGS_METADATA_KEY)?
            .unwrap_or_default())
    }

    pub fn thread_usage(&self, params: ThreadSettingsParams) -> Result<AppResponse, RuntimeError> {
        let thread = self.find_thread_record(&params.thread_id)?;
        Ok(value(ThreadUsageResult {
            usage: self.usage_for_thread(&thread),
            thread_id: params.thread_id,
        }))
    }

    pub(crate) fn usage_for_thread(&self, thread: &ThreadRecord) -> TokenUsage {
        let mut usage = TokenUsage::default();
        for turn in &thread.turns {
            if let Some(run) = self.runs.get(&turn.run_id) {
                merge_usage(
                    &mut usage,
                    usage_from_value(&serde_json::to_value(run).unwrap_or_default()),
                );
            }
        }
        usage.total_tokens = usage
            .input_tokens
            .saturating_add(usage.output_tokens)
            .saturating_add(usage.reasoning_output_tokens);
        usage
    }

    pub fn turn_diff(&self, params: TurnDiffParams) -> Result<AppResponse, RuntimeError> {
        let thread = self.find_thread_record(&params.thread_id)?;
        let turns = match params.turn_id.as_deref() {
            Some(turn_id) => vec![thread
                .turns
                .iter()
                .find(|turn| turn.id == turn_id)
                .ok_or_else(|| RuntimeError::not_found("turn not found"))?],
            None => thread.turns.iter().collect(),
        };
        Ok(value(TurnDiffResult {
            thread_id: params.thread_id,
            turn_id: params.turn_id,
            diff: aggregate_turn_diff(turns.into_iter()),
        }))
    }

    pub(crate) fn diff_for_turn(turn: &TurnRecord) -> String {
        aggregate_turn_diff(std::iter::once(turn))
    }

    pub fn config_read(&self, params: ConfigReadParams) -> Result<AppResponse, RuntimeError> {
        let mut values = self.runtime_config_values()?;
        if let Some(key) = params.key {
            validate_config_key(&key)?;
            values.retain(|candidate, _| candidate == &key);
        }
        Ok(value(ConfigReadResult {
            revision: config_revision(&values),
            values,
        }))
    }

    pub fn config_write(&mut self, params: ConfigWriteParams) -> Result<AppResponse, RuntimeError> {
        validate_config_key(&params.key)?;
        let mut values = self.runtime_config_values()?;
        values.insert(params.key, params.value);
        self.save_runtime_config_values(&values)
    }

    pub fn config_batch_write(
        &mut self,
        params: ConfigBatchWriteParams,
    ) -> Result<AppResponse, RuntimeError> {
        for key in params.values.keys() {
            validate_config_key(key)?;
        }
        let mut values = self.runtime_config_values()?;
        values.extend(params.values);
        self.save_runtime_config_values(&values)
    }

    pub fn config_reload(&mut self) -> Result<AppResponse, RuntimeError> {
        let values = self.runtime_config_values()?;
        self.apply_runtime_config_values(&values)?;
        let revision = config_revision(&values);
        Ok(AppResponse::WithEvents {
            result: to_value(ConfigReadResult {
                values,
                revision: revision.clone(),
            }),
            events: vec![AppServerEvent::ConfigReloaded { revision }],
        })
    }

    fn runtime_config_values(&self) -> Result<BTreeMap<String, Value>, RuntimeError> {
        Ok(self
            .metadata_json(RUNTIME_CONFIG_METADATA_KEY)?
            .unwrap_or_default())
    }

    fn save_runtime_config_values(
        &mut self,
        values: &BTreeMap<String, Value>,
    ) -> Result<AppResponse, RuntimeError> {
        self.apply_runtime_config_values(values)?;
        self.set_metadata_json(RUNTIME_CONFIG_METADATA_KEY, values)?;
        Ok(value(ConfigReadResult {
            revision: config_revision(values),
            values: values.clone(),
        }))
    }

    pub(crate) fn apply_runtime_config_from_store(&mut self) -> Result<(), RuntimeError> {
        let values = self.runtime_config_values()?;
        self.apply_runtime_config_values(&values)
    }

    fn apply_runtime_config_values(
        &mut self,
        values: &BTreeMap<String, Value>,
    ) -> Result<(), RuntimeError> {
        for (key, value) in values {
            match key.as_str() {
                "runtime.apiBaseUrl" | "runtime.ollamaBaseUrl" => {
                    config_string(key, value)?;
                }
                "runtime.simulateRunProgress"
                | "runtime.remoteModelCatalog"
                | "runtime.liveMcpAdapter"
                | "runtime.remoteSync" => {
                    config_bool(key, value)?;
                }
                _ => {}
            }
        }
        for (key, value) in values {
            match key.as_str() {
                "runtime.apiBaseUrl" => {
                    let url = config_string(key, value)?;
                    self.config.api_base_url = url.to_string();
                    self.api_client = ApiClient::new(url.to_string());
                }
                "runtime.ollamaBaseUrl" => {
                    self.config.ollama_base_url = config_string(key, value)?.to_string();
                }
                "runtime.simulateRunProgress" => {
                    self.config.simulate_run_progress = config_bool(key, value)?;
                }
                "runtime.remoteModelCatalog" => {
                    self.config.remote_model_catalog = config_bool(key, value)?;
                }
                "runtime.liveMcpAdapter" => {
                    self.config.live_mcp_adapter = config_bool(key, value)?;
                }
                "runtime.remoteSync" => {
                    self.config.remote_sync = config_bool(key, value)?;
                }
                _ => {}
            }
        }
        Ok(())
    }

    pub fn hook_list(&self) -> Result<AppResponse, RuntimeError> {
        Ok(value(HookListResult {
            hooks: self.hook_records()?,
        }))
    }

    pub fn hook_set(&mut self, params: HookSetParams) -> Result<AppResponse, RuntimeError> {
        validate_hook(&params.hook)?;
        let mut hooks = self.hook_records()?;
        if let Some(existing) = hooks.iter_mut().find(|hook| hook.id == params.hook.id) {
            *existing = params.hook;
        } else {
            hooks.push(params.hook);
        }
        hooks.sort_by(|left, right| left.id.cmp(&right.id));
        self.set_metadata_json(HOOKS_METADATA_KEY, &hooks)?;
        Ok(value(HookListResult { hooks }))
    }

    pub fn hook_remove(&mut self, params: HookRemoveParams) -> Result<AppResponse, RuntimeError> {
        let mut hooks = self.hook_records()?;
        hooks.retain(|hook| hook.id != params.id);
        self.set_metadata_json(HOOKS_METADATA_KEY, &hooks)?;
        Ok(value(HookListResult { hooks }))
    }

    pub(crate) fn run_lifecycle_hooks(
        &self,
        event: HookEvent,
        thread_id: Option<&str>,
    ) -> Result<Vec<AppServerEvent>, RuntimeError> {
        self.hook_records()?
            .into_iter()
            .filter(|hook| hook.enabled && hook.event == event)
            .map(|hook| {
                execute_hook(hook, thread_id).map(|result| AppServerEvent::HookCompleted { result })
            })
            .collect()
    }

    fn hook_records(&self) -> Result<Vec<HookRecord>, RuntimeError> {
        Ok(self.metadata_json(HOOKS_METADATA_KEY)?.unwrap_or_default())
    }

    pub fn fs_watch(&self, params: FsWatchParams) -> Result<AppResponse, RuntimeError> {
        let result = self
            .watch_manager
            .watch(params, self.event_sender.clone())?;
        Ok(value(result))
    }

    pub fn fs_unwatch(&self, params: FsUnwatchParams) -> Result<AppResponse, RuntimeError> {
        self.watch_manager.unwatch(&params.watch_id)?;
        Ok(value(AckResult { ok: true }))
    }
}

fn validate_thread_settings(settings: &ThreadExecutionSettings) -> Result<(), RuntimeError> {
    if settings
        .agent_count
        .is_some_and(|count| count == 0 || count > 64)
    {
        return Err(RuntimeError::invalid_params(
            "agentCount must be between 1 and 64",
        ));
    }
    if settings
        .workspace_root
        .as_deref()
        .is_some_and(str::is_empty)
    {
        return Err(RuntimeError::invalid_params(
            "workspaceRoot cannot be empty",
        ));
    }
    Ok(())
}

fn merge_usage(total: &mut TokenUsage, usage: TokenUsage) {
    total.input_tokens = total.input_tokens.saturating_add(usage.input_tokens);
    total.cached_input_tokens = total
        .cached_input_tokens
        .saturating_add(usage.cached_input_tokens);
    total.output_tokens = total.output_tokens.saturating_add(usage.output_tokens);
    total.reasoning_output_tokens = total
        .reasoning_output_tokens
        .saturating_add(usage.reasoning_output_tokens);
    total.context_window = total.context_window.max(usage.context_window);
}

fn usage_from_value(value: &Value) -> TokenUsage {
    let mut stack = vec![value];
    let mut total = TokenUsage::default();
    while let Some(candidate) = stack.pop() {
        match candidate {
            Value::Object(map) => {
                let number = |keys: &[&str]| {
                    keys.iter()
                        .find_map(|key| map.get(*key).and_then(Value::as_u64))
                        .unwrap_or_default()
                };
                let usage = TokenUsage {
                    input_tokens: number(&[
                        "inputTokens",
                        "input_tokens",
                        "promptTokens",
                        "prompt_tokens",
                    ]),
                    cached_input_tokens: number(&["cachedInputTokens", "cached_input_tokens"]),
                    output_tokens: number(&[
                        "outputTokens",
                        "output_tokens",
                        "completionTokens",
                        "completion_tokens",
                    ]),
                    reasoning_output_tokens: number(&[
                        "reasoningOutputTokens",
                        "reasoning_output_tokens",
                        "reasoningTokens",
                        "reasoning_tokens",
                    ]),
                    total_tokens: number(&["totalTokens", "total_tokens"]),
                    context_window: ["contextWindow", "context_window"]
                        .iter()
                        .find_map(|key| map.get(*key).and_then(Value::as_u64)),
                };
                if usage.total_tokens > 0
                    || usage.input_tokens > 0
                    || usage.output_tokens > 0
                    || usage.reasoning_output_tokens > 0
                {
                    merge_usage(&mut total, usage);
                    continue;
                }
                stack.extend(map.values());
            }
            Value::Array(values) => stack.extend(values),
            _ => {}
        }
    }
    total.total_tokens = total
        .input_tokens
        .saturating_add(total.output_tokens)
        .saturating_add(total.reasoning_output_tokens);
    total
}

fn aggregate_turn_diff<'a>(turns: impl Iterator<Item = &'a TurnRecord>) -> String {
    turns
        .flat_map(|turn| &turn.items)
        .filter(|item| item.item_type == ThreadItemType::FileChange)
        .filter_map(|item| {
            ["diff", "patch", "text"]
                .iter()
                .find_map(|key| item.content.get(*key).and_then(Value::as_str))
                .or_else(|| item.content.as_str())
        })
        .filter(|diff| !diff.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn validate_config_key(key: &str) -> Result<(), RuntimeError> {
    let key = key.trim();
    if key.is_empty() || key.len() > 160 {
        return Err(RuntimeError::invalid_params(
            "config key must be 1 to 160 characters",
        ));
    }
    let lower = key.to_ascii_lowercase();
    if ["token", "secret", "password", "credential"]
        .iter()
        .any(|word| lower.contains(word))
    {
        return Err(RuntimeError::invalid_params(
            "secret values must use their dedicated credential APIs",
        ));
    }
    Ok(())
}

fn config_string<'a>(key: &str, value: &'a Value) -> Result<&'a str, RuntimeError> {
    value
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| RuntimeError::invalid_params(format!("{key} must be a non-empty string")))
}

fn config_bool(key: &str, value: &Value) -> Result<bool, RuntimeError> {
    value
        .as_bool()
        .ok_or_else(|| RuntimeError::invalid_params(format!("{key} must be a boolean")))
}

fn config_revision(values: &BTreeMap<String, Value>) -> String {
    let mut hasher = DefaultHasher::new();
    serde_json::to_string(values)
        .unwrap_or_default()
        .hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn validate_hook(hook: &HookRecord) -> Result<(), RuntimeError> {
    if hook.id.trim().is_empty() || hook.command.trim().is_empty() || hook.cwd.trim().is_empty() {
        return Err(RuntimeError::invalid_params(
            "hook id, command, and cwd are required",
        ));
    }
    let cwd = PathBuf::from(&hook.cwd).canonicalize().map_err(|error| {
        RuntimeError::invalid_params(format!("hook cwd is unavailable: {error}"))
    })?;
    if !cwd.is_dir() {
        return Err(RuntimeError::invalid_params("hook cwd must be a directory"));
    }
    Ok(())
}

fn execute_hook(
    hook: HookRecord,
    thread_id: Option<&str>,
) -> Result<HookExecutionResult, RuntimeError> {
    validate_hook(&hook)?;
    let started = Instant::now();
    let mut command = Command::new(&hook.command);
    command
        .args(&hook.args)
        .current_dir(&hook.cwd)
        .env(
            "TASKFORCE_HOOK_EVENT",
            format!("{:?}", hook.event).to_ascii_lowercase(),
        )
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(thread_id) = thread_id {
        command.env("TASKFORCE_THREAD_ID", thread_id);
    }
    let mut child = command.spawn().map_err(|error| {
        RuntimeError::storage(format!("failed to start hook {}: {error}", hook.id))
    })?;
    let timeout = Duration::from_millis(hook.timeout_ms.unwrap_or(30_000).clamp(100, 300_000));
    loop {
        if child
            .try_wait()
            .map_err(|error| {
                RuntimeError::storage(format!("failed to inspect hook {}: {error}", hook.id))
            })?
            .is_some()
        {
            break;
        }
        if started.elapsed() >= timeout {
            let _ = child.kill();
            break;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    let output = child.wait_with_output().map_err(|error| {
        RuntimeError::storage(format!("failed to collect hook {}: {error}", hook.id))
    })?;
    Ok(HookExecutionResult {
        hook_id: hook.id,
        event: hook.event,
        success: output.status.success(),
        exit_code: output.status.code(),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        duration_ms: started.elapsed().as_millis().min(u64::MAX as u128) as u64,
    })
}

#[derive(Debug)]
struct WatchHandle {
    active: Arc<AtomicBool>,
}

#[derive(Debug, Default)]
pub(crate) struct FsWatchManager {
    next_id: AtomicU64,
    watches: Mutex<BTreeMap<String, WatchHandle>>,
}

impl FsWatchManager {
    fn watch(
        &self,
        params: FsWatchParams,
        sender: Option<mpsc::Sender<AppServerEvent>>,
    ) -> Result<FsWatchResult, RuntimeError> {
        let workspace = PathBuf::from(&params.workspace_root)
            .canonicalize()
            .map_err(|error| {
                RuntimeError::invalid_params(format!("workspaceRoot is unavailable: {error}"))
            })?;
        if !workspace.is_dir() {
            return Err(RuntimeError::invalid_params(
                "workspaceRoot must be a directory",
            ));
        }
        let requested = if params.paths.is_empty() {
            vec![String::from(".")]
        } else {
            params.paths
        };
        let mut targets = Vec::with_capacity(requested.len());
        for relative in &requested {
            let target = workspace.join(relative).canonicalize().map_err(|error| {
                RuntimeError::invalid_params(format!("watch path is unavailable: {error}"))
            })?;
            if !target.starts_with(&workspace) {
                return Err(RuntimeError::invalid_params(
                    "watch path escapes workspaceRoot",
                ));
            }
            targets.push(target);
        }
        let recursive = params.recursive.unwrap_or(true);
        let id = format!("watch-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let active = Arc::new(AtomicBool::new(true));
        self.watches
            .lock()
            .map_err(|_| RuntimeError::storage("filesystem watch lock was poisoned"))?
            .insert(
                id.clone(),
                WatchHandle {
                    active: Arc::clone(&active),
                },
            );
        let watch_id = id.clone();
        let workspace_for_thread = workspace.clone();
        std::thread::spawn(move || {
            let mut previous = file_snapshot(&targets, recursive);
            while active.load(Ordering::Relaxed) {
                std::thread::sleep(Duration::from_millis(350));
                let current = file_snapshot(&targets, recursive);
                let changed = changed_paths(&previous, &current, &workspace_for_thread);
                previous = current;
                if changed.is_empty() {
                    continue;
                }
                let Some(sender) = &sender else {
                    continue;
                };
                if sender.is_closed() {
                    break;
                }
                let _ = sender.try_send(AppServerEvent::FsChanged {
                    watch_id: watch_id.clone(),
                    workspace_root: workspace_for_thread.display().to_string(),
                    paths: changed,
                });
            }
        });
        Ok(FsWatchResult {
            watch_id: id,
            workspace_root: workspace.display().to_string(),
            paths: requested,
            recursive,
        })
    }

    fn unwatch(&self, watch_id: &str) -> Result<(), RuntimeError> {
        let handle = self
            .watches
            .lock()
            .map_err(|_| RuntimeError::storage("filesystem watch lock was poisoned"))?
            .remove(watch_id)
            .ok_or_else(|| RuntimeError::not_found("filesystem watch not found"))?;
        handle.active.store(false, Ordering::Relaxed);
        Ok(())
    }
}

type FileSnapshot = HashMap<PathBuf, (u64, u64)>;

fn file_snapshot(targets: &[PathBuf], recursive: bool) -> FileSnapshot {
    let mut snapshot = HashMap::new();
    let mut pending = targets.to_vec();
    while let Some(path) = pending.pop() {
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };
        if metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.is_file() {
            let modified = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_nanos().min(u64::MAX as u128) as u64)
                .unwrap_or_default();
            snapshot.insert(path, (modified, metadata.len()));
            continue;
        }
        let Ok(entries) = fs::read_dir(&path) else {
            continue;
        };
        for entry in entries.flatten() {
            let candidate = entry.path();
            if candidate
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| {
                    matches!(
                        name,
                        ".git" | "node_modules" | "target" | ".next" | ".turbo"
                    )
                })
            {
                continue;
            }
            if recursive || candidate.is_file() {
                pending.push(candidate);
            }
        }
    }
    snapshot
}

fn changed_paths(previous: &FileSnapshot, current: &FileSnapshot, workspace: &Path) -> Vec<String> {
    let mut changed = BTreeSet::new();
    for path in previous.keys().chain(current.keys()) {
        if previous.get(path) != current.get(path) {
            changed.insert(
                path.strip_prefix(workspace)
                    .unwrap_or(path)
                    .to_string_lossy()
                    .replace('\\', "/"),
            );
        }
    }
    changed.into_iter().take(512).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::{AppRuntime, RuntimeConfig};

    fn response_value(response: AppResponse) -> Value {
        match response {
            AppResponse::Value(value) | AppResponse::Shutdown(value) => value,
            AppResponse::WithEvents { result, .. } => result,
        }
    }

    #[test]
    fn thread_settings_and_general_config_are_durable() {
        let store_path = std::env::temp_dir().join(format!(
            "taskforceai-compat-{}.sqlite",
            super::super::util::unix_millis()
        ));
        let config = RuntimeConfig::default().with_run_store_path(&store_path);
        let mut runtime = AppRuntime::try_new(config.clone()).expect("runtime should start");
        runtime
            .thread_start(ThreadStartParams {
                objective: "Sticky context".to_string(),
                thread_id: Some("settings-thread".to_string()),
                title: None,
                source: None,
                task_mode: TaskMode::Code,
                settings: Some(ThreadExecutionSettings {
                    model_id: Some("gpt-test".to_string()),
                    workspace_root: Some(std::env::temp_dir().display().to_string()),
                    permission_profile: Some(PermissionProfile::ReadOnly),
                    ..ThreadExecutionSettings::default()
                }),
            })
            .expect("thread should start");
        runtime
            .config_batch_write(ConfigBatchWriteParams {
                values: BTreeMap::from([
                    (
                        "model.default".to_string(),
                        Value::String("gpt-test".to_string()),
                    ),
                    (
                        "sandbox.mode".to_string(),
                        Value::String("read_only".to_string()),
                    ),
                    ("runtime.simulateRunProgress".to_string(), Value::Bool(true)),
                ]),
            })
            .expect("config should save");
        drop(runtime);

        let runtime = AppRuntime::try_new(config).expect("runtime should reload");
        assert!(runtime.config.simulate_run_progress);
        let settings = response_value(
            runtime
                .thread_settings_get(ThreadSettingsParams {
                    thread_id: "settings-thread".to_string(),
                })
                .expect("settings should load"),
        );
        assert_eq!(settings["settings"]["modelId"], "gpt-test");
        let config = response_value(
            runtime
                .config_read(ConfigReadParams::default())
                .expect("config should load"),
        );
        assert_eq!(config["values"]["sandbox.mode"], "read_only");
        let _ = std::fs::remove_file(store_path);
    }

    #[test]
    fn hooks_execute_without_an_implicit_shell() {
        let mut runtime = AppRuntime::new(RuntimeConfig::default());
        let cwd = std::env::temp_dir().canonicalize().expect("temp directory");
        runtime
            .hook_set(HookSetParams {
                hook: HookRecord {
                    id: "before-turn".to_string(),
                    event: HookEvent::BeforeTurnStart,
                    command: "/usr/bin/env".to_string(),
                    args: Vec::new(),
                    cwd: cwd.display().to_string(),
                    enabled: true,
                    timeout_ms: Some(5_000),
                },
            })
            .expect("hook should save");
        let events = runtime
            .run_lifecycle_hooks(HookEvent::BeforeTurnStart, Some("thread-one"))
            .expect("hook should execute");
        let AppServerEvent::HookCompleted { result } = &events[0] else {
            panic!("expected hook completion");
        };
        assert!(result.success);
        assert!(result.stdout.contains("TASKFORCE_THREAD_ID=thread-one"));
    }

    #[test]
    fn usage_and_diff_projection_accept_upstream_token_shapes() {
        let usage = usage_from_value(&serde_json::json!({
            "usage": {
                "inputTokens": 12,
                "cachedInputTokens": 3,
                "outputTokens": 7,
                "reasoningTokens": 2,
                "contextWindow": 128000
            }
        }));
        assert_eq!(usage.input_tokens, 12);
        assert_eq!(usage.output_tokens, 7);
        assert_eq!(usage.context_window, Some(128_000));

        let turn = TurnRecord {
            id: "turn-one".to_string(),
            thread_id: "thread-one".to_string(),
            run_id: "run-one".to_string(),
            status: TurnStatus::Completed,
            items: vec![ThreadItemRecord {
                id: "change-one".to_string(),
                turn_id: "turn-one".to_string(),
                item_type: ThreadItemType::FileChange,
                status: ThreadItemStatus::Completed,
                content: serde_json::json!({"diff": "diff --git a/a b/a"}),
                created_at: 1,
                updated_at: 1,
            }],
            created_at: 1,
            updated_at: 1,
        };
        assert_eq!(AppRuntime::diff_for_turn(&turn), "diff --git a/a b/a");
    }

    #[tokio::test]
    async fn filesystem_watch_pushes_changed_paths() {
        let root = std::env::temp_dir().join(format!(
            "taskforceai-watch-{}",
            super::super::util::unix_millis()
        ));
        std::fs::create_dir_all(&root).expect("watch root");
        let (sender, mut receiver) = mpsc::channel(8);
        let mut runtime = AppRuntime::new(RuntimeConfig::default());
        runtime.set_event_sender(sender);
        let watched = response_value(
            runtime
                .fs_watch(FsWatchParams {
                    workspace_root: root.display().to_string(),
                    paths: Vec::new(),
                    recursive: Some(true),
                })
                .expect("watch should start"),
        );
        let watch_id = watched["watchId"].as_str().expect("watch id").to_string();
        tokio::time::sleep(Duration::from_millis(450)).await;
        std::fs::write(root.join("changed.txt"), "changed").expect("write watched file");
        let event = tokio::time::timeout(Duration::from_secs(3), receiver.recv())
            .await
            .expect("watch notification timeout")
            .expect("watch notification");
        let AppServerEvent::FsChanged { paths, .. } = event else {
            panic!("expected fs changed event");
        };
        assert_eq!(paths, vec!["changed.txt"]);
        runtime
            .fs_unwatch(FsUnwatchParams { watch_id })
            .expect("watch should stop");
        let _ = std::fs::remove_dir_all(root);
    }
}
