use serde::{Deserialize, Serialize};

use crate::{
    HookExecutionResult, JsonRpcServerRequest, McpInspectResult, ProcessRecord, RunRecord,
    ThreadItemRecord, ThreadRecord, TokenUsage, TurnRecord, WorkflowRunRecord,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AppServerEvent {
    RunUpdated {
        run: Box<RunRecord>,
    },
    RunDeleted {
        run_id: String,
    },
    TurnStarted {
        thread_id: String,
        turn: Box<TurnRecord>,
    },
    TurnInterrupted {
        thread_id: String,
        turn: Box<TurnRecord>,
    },
    TurnUpdated {
        thread_id: String,
        turn: Box<TurnRecord>,
    },
    TurnCompleted {
        thread_id: String,
        turn: Box<TurnRecord>,
    },
    ItemStarted {
        thread_id: String,
        turn_id: String,
        item: Box<ThreadItemRecord>,
    },
    ItemUpdated {
        thread_id: String,
        turn_id: String,
        item: Box<ThreadItemRecord>,
    },
    ItemCompleted {
        thread_id: String,
        turn_id: String,
        item: Box<ThreadItemRecord>,
    },
    ItemDelta {
        thread_id: String,
        turn_id: String,
        item_id: String,
        item_type: crate::ThreadItemType,
        field: String,
        delta: String,
    },
    PlanUpdated {
        thread_id: String,
        turn_id: String,
        item_id: String,
        plan: serde_json::Value,
    },
    ThreadUpdated {
        thread: Box<ThreadRecord>,
    },
    ThreadTokenUsageUpdated {
        thread_id: String,
        usage: TokenUsage,
    },
    TurnDiffUpdated {
        thread_id: String,
        turn_id: String,
        diff: String,
    },
    ProcessOutputDelta {
        process_id: String,
        delta: String,
        cursor: usize,
    },
    ProcessExited {
        process: ProcessRecord,
    },
    FsChanged {
        watch_id: String,
        workspace_root: String,
        paths: Vec<String>,
    },
    HookCompleted {
        result: HookExecutionResult,
    },
    ConfigReloaded {
        revision: String,
    },
    WorkflowRunUpdated {
        run: Box<WorkflowRunRecord>,
    },
    McpStartupStatusUpdated {
        status: Box<McpInspectResult>,
    },
    McpOAuthCompleted {
        status: Box<McpInspectResult>,
    },
    ServerRequest {
        request: JsonRpcServerRequest,
    },
}
