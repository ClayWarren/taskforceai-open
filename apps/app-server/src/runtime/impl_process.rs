use std::collections::BTreeMap;
use std::fmt;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};

use crate::protocol::*;

use super::error::RuntimeError;
use super::util::{unix_millis, value};

const DEFAULT_OUTPUT_LIMIT: usize = 64 * 1024;
const MAX_OUTPUT_LIMIT: usize = 1024 * 1024;
const MAX_PROCESS_OUTPUT_BYTES: usize = 4 * 1024 * 1024;
const MAX_RUNNING_PROCESSES: usize = 32;
const MAX_RETAINED_PROCESSES: usize = 256;

struct ProcessHandle {
    record: ProcessRecord,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    output: Arc<Mutex<Vec<u8>>>,
    output_closed: Arc<AtomicBool>,
}

#[derive(Default)]
pub(crate) struct ProcessManager {
    next_id: AtomicU64,
    processes: Mutex<BTreeMap<String, ProcessHandle>>,
}

impl fmt::Debug for ProcessManager {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let count = self
            .processes
            .lock()
            .map(|processes| processes.len())
            .unwrap_or_default();
        formatter
            .debug_struct("ProcessManager")
            .field("process_count", &count)
            .finish()
    }
}

impl crate::runtime::AppRuntime {
    pub fn process_list(&self) -> Result<AppResponse, RuntimeError> {
        let mut processes = self.lock_processes()?;
        let mut records = Vec::with_capacity(processes.len());
        for process in processes.values_mut() {
            refresh_process(process);
            records.push(process.record.clone());
        }
        records.sort_by_key(|process| std::cmp::Reverse(process.started_at));
        Ok(value(ProcessListResult { processes: records }))
    }

    pub fn process_start(&self, params: ProcessStartParams) -> Result<AppResponse, RuntimeError> {
        let command = params.command.trim();
        if command.is_empty() {
            return Err(RuntimeError::invalid_params("command is required"));
        }
        match params.permission_profile {
            PermissionProfile::FullAccess => {}
            PermissionProfile::ReadOnly => {
                return Err(RuntimeError::invalid_params(
                    "read_only permission does not allow process execution",
                ));
            }
            PermissionProfile::WorkspaceWrite => {
                return Err(RuntimeError::invalid_params(
                    "workspace_write process execution is unavailable because the host PTY cannot confine file reads; explicitly approved full_access is required",
                ));
            }
        }
        let (workspace_root, cwd) = process_paths(&params.workspace_root, &params.cwd)?;
        {
            let mut processes = self.lock_processes()?;
            for process in processes.values_mut() {
                refresh_process(process);
            }
            if processes
                .values()
                .filter(|process| process.record.status == ProcessStatus::Running)
                .count()
                >= MAX_RUNNING_PROCESSES
            {
                return Err(RuntimeError::invalid_params(
                    "too many workspace processes are running",
                ));
            }
        }
        let cols = params.cols.unwrap_or(120).clamp(20, 500);
        let rows = params.rows.unwrap_or(30).clamp(5, 300);
        let pair = native_pty_system()
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| RuntimeError::storage(format!("failed to open PTY: {error}")))?;
        let mut builder = CommandBuilder::new(command);
        builder.args(&params.args);
        builder.cwd(&cwd);
        for (key, value) in &params.env {
            validate_env_key(key)?;
            builder.env(key, value);
        }
        builder.env("TASKFORCEAI_WORKSPACE_ROOT", &workspace_root);
        builder.env(
            "TASKFORCEAI_PERMISSION_PROFILE",
            match params.permission_profile {
                PermissionProfile::ReadOnly => "read_only",
                PermissionProfile::WorkspaceWrite => "workspace_write",
                PermissionProfile::FullAccess => "full_access",
            },
        );
        let child = pair
            .slave
            .spawn_command(builder)
            .map_err(|error| RuntimeError::storage(format!("failed to start process: {error}")))?;
        drop(pair.slave);
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| RuntimeError::storage(format!("failed to read PTY: {error}")))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|error| RuntimeError::storage(format!("failed to write PTY: {error}")))?;
        let now = unix_millis();
        let sequence = self.process_manager.next_id.fetch_add(1, Ordering::Relaxed);
        let id = format!("process-{now}-{sequence}");
        let record = ProcessRecord {
            id: id.clone(),
            command: command.to_string(),
            args: params.args,
            cwd: cwd.display().to_string(),
            workspace_root: workspace_root.display().to_string(),
            status: ProcessStatus::Running,
            exit_code: None,
            started_at: now,
            updated_at: now,
            output_cursor: 0,
        };
        let output = Arc::new(Mutex::new(Vec::new()));
        let reader_output = Arc::clone(&output);
        let output_closed = Arc::new(AtomicBool::new(false));
        let reader_output_closed = Arc::clone(&output_closed);
        let process_id = id.clone();
        let event_sender = self.event_sender.clone();
        let mut exited_record = record.clone();
        std::thread::spawn(move || {
            let mut buffer = [0_u8; 8192];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(read) => {
                        if let Ok(mut output) = reader_output.lock() {
                            let remaining = MAX_PROCESS_OUTPUT_BYTES.saturating_sub(output.len());
                            let appended = read.min(remaining);
                            output.extend_from_slice(&buffer[..appended]);
                            let cursor = output.len();
                            if appended > 0 {
                                if let Some(sender) = &event_sender {
                                    let _ = sender.try_send(AppServerEvent::ProcessOutputDelta {
                                        process_id: process_id.clone(),
                                        delta: String::from_utf8_lossy(&buffer[..appended])
                                            .into_owned(),
                                        cursor,
                                    });
                                }
                            }
                        } else {
                            break;
                        }
                    }
                }
            }
            reader_output_closed.store(true, Ordering::Release);
            if let Some(sender) = &event_sender {
                exited_record.status = ProcessStatus::Exited;
                exited_record.updated_at = unix_millis();
                let _ = sender.try_send(AppServerEvent::ProcessExited {
                    process: exited_record,
                });
            }
        });
        let mut processes = self.lock_processes()?;
        if processes.len() >= MAX_RETAINED_PROCESSES {
            let remove = processes
                .values()
                .filter(|process| process.record.status != ProcessStatus::Running)
                .min_by_key(|process| process.record.updated_at)
                .map(|process| process.record.id.clone());
            if let Some(process_id) = remove {
                processes.remove(&process_id);
            }
        }
        processes.insert(
            id,
            ProcessHandle {
                record: record.clone(),
                master: pair.master,
                writer,
                child,
                output,
                output_closed,
            },
        );
        Ok(value(ProcessResult { process: record }))
    }

    pub fn process_read(&self, params: ProcessReadParams) -> Result<AppResponse, RuntimeError> {
        let mut processes = self.lock_processes()?;
        let process = process_mut(&mut processes, &params.process_id)?;
        refresh_process(process);
        let output = process
            .output
            .lock()
            .map_err(|_| RuntimeError::storage("process output lock was poisoned"))?;
        let cursor = params.cursor.unwrap_or_default().min(output.len());
        let limit = params
            .limit
            .unwrap_or(DEFAULT_OUTPUT_LIMIT)
            .clamp(1, MAX_OUTPUT_LIMIT);
        let output_len = output.len();
        let output_closed = process.output_closed.load(Ordering::Acquire);
        let end = utf8_page_end(&output, cursor, limit, !output_closed);
        let data = String::from_utf8_lossy(&output[cursor..end]).into_owned();
        drop(output);
        process.record.output_cursor = end;
        let eof =
            output_closed && process.record.status != ProcessStatus::Running && end >= output_len;
        Ok(value(ProcessReadResult {
            process: process.record.clone(),
            data,
            next_cursor: end,
            eof,
        }))
    }

    pub fn process_write(&self, params: ProcessWriteParams) -> Result<AppResponse, RuntimeError> {
        let mut processes = self.lock_processes()?;
        let process = process_mut(&mut processes, &params.process_id)?;
        refresh_process(process);
        if process.record.status != ProcessStatus::Running {
            return Err(RuntimeError::invalid_params("process is not running"));
        }
        process
            .writer
            .write_all(params.data.as_bytes())
            .and_then(|()| process.writer.flush())
            .map_err(|error| RuntimeError::storage(format!("failed to write process: {error}")))?;
        process.record.updated_at = unix_millis();
        Ok(value(ProcessResult {
            process: process.record.clone(),
        }))
    }

    pub fn process_resize(&self, params: ProcessResizeParams) -> Result<AppResponse, RuntimeError> {
        if params.cols < 20 || params.rows < 5 {
            return Err(RuntimeError::invalid_params("PTY size is too small"));
        }
        let mut processes = self.lock_processes()?;
        let process = process_mut(&mut processes, &params.process_id)?;
        process
            .master
            .resize(PtySize {
                rows: params.rows,
                cols: params.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| RuntimeError::storage(format!("failed to resize PTY: {error}")))?;
        process.record.updated_at = unix_millis();
        Ok(value(ProcessResult {
            process: process.record.clone(),
        }))
    }

    pub fn process_kill(&self, params: ProcessIDParams) -> Result<AppResponse, RuntimeError> {
        let mut processes = self.lock_processes()?;
        let process = process_mut(&mut processes, &params.process_id)?;
        refresh_process(process);
        if process.record.status == ProcessStatus::Running {
            process.child.kill().map_err(|error| {
                RuntimeError::storage(format!("failed to kill process: {error}"))
            })?;
            process.record.status = ProcessStatus::Killed;
            process.record.updated_at = unix_millis();
        }
        Ok(value(ProcessResult {
            process: process.record.clone(),
        }))
    }

    fn lock_processes(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, BTreeMap<String, ProcessHandle>>, RuntimeError> {
        self.process_manager
            .processes
            .lock()
            .map_err(|_| RuntimeError::storage("process manager lock was poisoned"))
    }
}

fn utf8_page_end(output: &[u8], cursor: usize, limit: usize, wait_for_more: bool) -> usize {
    let mut end = output.len().min(cursor.saturating_add(limit));
    while end < output.len() && output[end] & 0b1100_0000 == 0b1000_0000 {
        end += 1;
    }
    if !wait_for_more || end < output.len() || end == cursor {
        return end;
    }

    let mut sequence_start = end;
    while sequence_start > cursor && output[sequence_start - 1] & 0b1100_0000 == 0b1000_0000 {
        sequence_start -= 1;
    }
    if sequence_start == cursor {
        return end;
    }
    sequence_start -= 1;
    let expected_bytes = match output[sequence_start] {
        0xC2..=0xDF => 2,
        0xE0..=0xEF => 3,
        0xF0..=0xF4 => 4,
        _ => 1,
    };
    if expected_bytes > end - sequence_start {
        sequence_start
    } else {
        end
    }
}

fn process_mut<'a>(
    processes: &'a mut BTreeMap<String, ProcessHandle>,
    process_id: &str,
) -> Result<&'a mut ProcessHandle, RuntimeError> {
    processes
        .get_mut(process_id)
        .ok_or_else(|| RuntimeError::not_found("process not found"))
}

fn refresh_process(process: &mut ProcessHandle) {
    if process.record.status != ProcessStatus::Running {
        return;
    }
    match process.child.try_wait() {
        Ok(Some(status)) => {
            process.record.status = ProcessStatus::Exited;
            process.record.exit_code = Some(status.exit_code());
            process.record.updated_at = unix_millis();
        }
        Ok(None) => {}
        Err(_) => {
            process.record.status = ProcessStatus::Failed;
            process.record.updated_at = unix_millis();
        }
    }
}

fn process_paths(workspace_root: &str, cwd: &str) -> Result<(PathBuf, PathBuf), RuntimeError> {
    let workspace_root = canonical_directory(workspace_root, "workspaceRoot")?;
    let cwd = canonical_directory(cwd, "cwd")?;
    if !cwd.starts_with(&workspace_root) {
        return Err(RuntimeError::invalid_params(
            "cwd must be inside workspaceRoot",
        ));
    }
    Ok((workspace_root, cwd))
}

fn canonical_directory(value: &str, label: &str) -> Result<PathBuf, RuntimeError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(RuntimeError::invalid_params(format!("{label} is required")));
    }
    let path = PathBuf::from(value).canonicalize().map_err(|error| {
        RuntimeError::invalid_params(format!("{label} is unavailable: {error}"))
    })?;
    if !path.is_dir() {
        return Err(RuntimeError::invalid_params(format!(
            "{label} must be a directory"
        )));
    }
    Ok(path)
}

fn validate_env_key(key: &str) -> Result<(), RuntimeError> {
    if key.is_empty()
        || !key
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
    {
        return Err(RuntimeError::invalid_params(
            "invalid environment variable name",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workspace_write_processes_cannot_read_outside_the_workspace() {
        let suffix = format!("{}-{}", std::process::id(), unix_millis());
        let root = std::env::temp_dir().join(format!("taskforceai-process-read-scope-{suffix}"));
        let outside = std::env::temp_dir().join(format!("taskforceai-process-secret-{suffix}"));
        std::fs::create_dir_all(&root).expect("create process workspace");
        std::fs::write(&outside, "WORKSPACE_PROCESS_READ_ESCAPE\n").expect("write outside secret");

        let runtime = crate::runtime::AppRuntime::new(crate::runtime::RuntimeConfig::default());
        let error = runtime
            .process_start(ProcessStartParams {
                command: "sh".to_string(),
                args: vec!["-c".to_string(), format!("cat '{}'", outside.display())],
                cwd: root.display().to_string(),
                workspace_root: root.display().to_string(),
                env: BTreeMap::new(),
                cols: Some(80),
                rows: Some(24),
                permission_profile: PermissionProfile::WorkspaceWrite,
            })
            .expect_err("workspace_write must not start a host PTY without read confinement");

        assert!(error.to_string().contains("full_access"));
        std::fs::remove_dir_all(root).ok();
        std::fs::remove_file(outside).ok();
    }

    #[test]
    fn environment_keys_are_strict() {
        assert!(validate_env_key("RUST_LOG").is_ok());
        assert!(validate_env_key("BAD-NAME").is_err());
    }

    #[test]
    fn process_output_pages_preserve_complete_utf8_sequences() {
        assert_eq!(utf8_page_end("é".as_bytes(), 0, 1, true), 2);
        assert_eq!(utf8_page_end(&[0xE2, 0x82], 0, 2, true), 0);
        assert_eq!(utf8_page_end(&[0xF0, 0x9F, 0x98], 0, 3, true), 0);
        assert_eq!(utf8_page_end(&[0xE2, 0x82], 0, 2, false), 2);
        assert_eq!(utf8_page_end(&[0xFF], 0, 1, true), 1);
        assert_eq!(utf8_page_end(&[0x82], 0, 1, true), 1);
        assert_eq!(utf8_page_end(b"ab", 0, 1, true), 1);
        assert_eq!(utf8_page_end(b"ok", 2, 1, true), 2);
    }

    #[test]
    fn process_lifecycle_streams_pty_output() {
        let root = std::env::temp_dir().join(format!(
            "taskforceai-process-test-{}-{}",
            std::process::id(),
            unix_millis()
        ));
        std::fs::create_dir_all(&root).expect("create process workspace");
        let runtime = crate::runtime::AppRuntime::new(crate::runtime::RuntimeConfig::default());
        let started = runtime
            .process_start(ProcessStartParams {
                command: "/bin/sh".to_string(),
                args: vec!["-c".to_string(), "printf process-ok".to_string()],
                cwd: root.display().to_string(),
                workspace_root: root.display().to_string(),
                env: BTreeMap::new(),
                cols: Some(80),
                rows: Some(24),
                permission_profile: PermissionProfile::FullAccess,
            })
            .expect("start PTY process");
        let process_id = match started {
            AppResponse::Value(value) => value["process"]["id"]
                .as_str()
                .expect("process id")
                .to_string(),
            _ => panic!("unexpected process response"),
        };
        let mut output = String::new();
        for _ in 0..100 {
            let result = runtime
                .process_read(ProcessReadParams {
                    process_id: process_id.clone(),
                    cursor: Some(0),
                    limit: None,
                })
                .expect("read PTY process");
            if let AppResponse::Value(value) = result {
                output = value["data"].as_str().unwrap_or_default().to_string();
                if value["eof"].as_bool() == Some(true) && output.contains("process-ok") {
                    break;
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        assert!(output.contains("process-ok"));
        assert_eq!(
            match runtime.process_list().expect("list processes") {
                AppResponse::Value(value) => value["processes"].as_array().unwrap().len(),
                _ => 0,
            },
            1
        );
        std::fs::remove_dir_all(root).ok();
    }

    #[tokio::test]
    async fn process_output_is_pushed_without_polling() {
        let root = std::env::temp_dir().join(format!(
            "taskforceai-process-events-{}-{}",
            std::process::id(),
            unix_millis()
        ));
        std::fs::create_dir_all(&root).expect("create process workspace");
        let (sender, mut receiver) = tokio::sync::mpsc::channel(8);
        let mut runtime = crate::runtime::AppRuntime::new(crate::runtime::RuntimeConfig::default());
        runtime.set_event_sender(sender);
        runtime
            .process_start(ProcessStartParams {
                command: "/bin/sh".to_string(),
                args: vec!["-c".to_string(), "printf pushed-output".to_string()],
                cwd: root.display().to_string(),
                workspace_root: root.display().to_string(),
                env: BTreeMap::new(),
                cols: Some(80),
                rows: Some(24),
                permission_profile: PermissionProfile::FullAccess,
            })
            .expect("start PTY process");
        let event = tokio::time::timeout(std::time::Duration::from_secs(3), receiver.recv())
            .await
            .expect("process event timeout")
            .expect("process event");
        assert!(matches!(
            event,
            AppServerEvent::ProcessOutputDelta { delta, .. } if delta.contains("pushed-output")
        ));
        std::fs::remove_dir_all(root).ok();
    }
}
