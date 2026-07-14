use serde::{Deserialize, Serialize};

use crate::{
    JsonRpcServerRequest, RunRecord, ThreadItemRecord, ThreadRecord, TurnRecord, WorkflowRunRecord,
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
    ThreadUpdated {
        thread: Box<ThreadRecord>,
    },
    WorkflowRunUpdated {
        run: Box<WorkflowRunRecord>,
    },
    ServerRequest {
        request: JsonRpcServerRequest,
    },
}
