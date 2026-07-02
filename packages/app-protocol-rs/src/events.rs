use serde::{Deserialize, Serialize};

use crate::{RunRecord, WorkflowRunRecord};

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
        run: Box<RunRecord>,
    },
    TurnInterrupted {
        thread_id: String,
        run: Box<RunRecord>,
    },
    WorkflowRunUpdated {
        run: Box<WorkflowRunRecord>,
    },
}
