use serde::Serialize;
use serde_json::json;

use crate::protocol::*;

use crate::runtime::error::RuntimeError;
use crate::runtime::impl_workflows;
use crate::runtime::util::*;
use crate::runtime::{
    CHANNELS_METADATA_KEY, SCHEDULES_METADATA_KEY, WORKFLOWS_METADATA_KEY,
    WORKFLOW_RUNS_METADATA_KEY,
};

impl crate::runtime::AppRuntime {
    pub(crate) fn channels(&self) -> Result<Vec<ChannelRecord>, RuntimeError> {
        load_metadata_vec(self.metadata_value(CHANNELS_METADATA_KEY)?)
    }

    pub(crate) fn save_channels(&mut self, channels: &[ChannelRecord]) -> Result<(), RuntimeError> {
        self.save_metadata_vec(CHANNELS_METADATA_KEY, channels)
    }

    pub(crate) fn schedules(&self) -> Result<Vec<ScheduleRecord>, RuntimeError> {
        load_metadata_vec(self.metadata_value(SCHEDULES_METADATA_KEY)?)
    }

    pub(crate) fn save_schedules(
        &mut self,
        schedules: &[ScheduleRecord],
    ) -> Result<(), RuntimeError> {
        self.save_metadata_vec(SCHEDULES_METADATA_KEY, schedules)
    }

    pub(crate) fn workflows(&self) -> Result<Vec<WorkflowDefinitionRecord>, RuntimeError> {
        load_metadata_vec(self.metadata_value(WORKFLOWS_METADATA_KEY)?)
    }

    pub(crate) fn save_workflows(
        &mut self,
        workflows: &[WorkflowDefinitionRecord],
    ) -> Result<(), RuntimeError> {
        self.save_metadata_vec(WORKFLOWS_METADATA_KEY, workflows)
    }

    pub(crate) fn workflow_runs(&self) -> Result<Vec<WorkflowRunRecord>, RuntimeError> {
        load_metadata_vec(self.metadata_value(WORKFLOW_RUNS_METADATA_KEY)?)
    }

    pub(crate) fn save_workflow_runs(
        &mut self,
        runs: &[WorkflowRunRecord],
    ) -> Result<(), RuntimeError> {
        self.save_metadata_vec(WORKFLOW_RUNS_METADATA_KEY, runs)
    }

    pub(crate) fn find_workflow(
        &self,
        workflow_id: &str,
    ) -> Result<WorkflowDefinitionRecord, RuntimeError> {
        self.workflows()?
            .into_iter()
            .find(|workflow| workflow.workflow_id == workflow_id)
            .ok_or_else(|| RuntimeError::not_found("workflow not found"))
    }

    pub(crate) fn update_workflow_runs_for_run(
        &mut self,
        run: &RunRecord,
    ) -> Result<Vec<WorkflowRunRecord>, RuntimeError> {
        let mut workflow_runs = self.workflow_runs()?;
        let mut updated = Vec::new();
        for workflow_run in &mut workflow_runs {
            if matches!(
                workflow_run.state,
                WorkflowRunState::Completed
                    | WorkflowRunState::Failed
                    | WorkflowRunState::Cancelled
            ) {
                continue; // coverage:ignore-line
            }
            let mut changed = false;
            for phase in &mut workflow_run.phase_runs {
                if !phase.agent_run_ids.iter().any(|run_id| run_id == &run.id) {
                    continue;
                }
                let linked_runs = phase
                    .agent_run_ids
                    .iter()
                    .filter_map(|run_id| self.runs.get(run_id))
                    .collect::<Vec<_>>();
                if linked_runs.is_empty() {
                    continue; // coverage:ignore-line
                }
                if linked_runs
                    .iter()
                    .any(|linked| linked.status == RunStatus::Failed)
                {
                    // coverage:ignore-start
                    phase.state = WorkflowRunState::Failed;
                    phase.error = linked_runs.iter().find_map(|linked| linked.error.clone());
                    phase.completed_at = Some(run.updated_at);
                    changed = true;
                // coverage:ignore-end
                } else if linked_runs
                    .iter() // coverage:ignore-line
                    .any(|linked| linked.status == RunStatus::Canceled)
                // coverage:ignore-line
                // coverage:ignore-start
                {
                    phase.state = WorkflowRunState::Cancelled;
                    phase.completed_at = Some(run.updated_at);
                    changed = true;
                // coverage:ignore-end
                } else if linked_runs
                    .iter()
                    .all(|linked| linked.status == RunStatus::Completed)
                {
                    phase.state = WorkflowRunState::Completed;
                    phase.completed_at = Some(run.updated_at);
                    phase.result = Some(json!({
                        "runIds": phase.agent_run_ids,
                        "outputs": linked_runs
                            .iter()
                            .filter_map(|linked| linked.output.clone()) // coverage:ignore-line
                            .collect::<Vec<_>>()
                    }));
                    changed = true;
                } // coverage:ignore-line
            }
            if changed {
                workflow_run.updated_at = unix_millis();
                if workflow_run
                    .phase_runs // coverage:ignore-line
                    .iter() // coverage:ignore-line
                    .any(|phase| phase.state == WorkflowRunState::Failed)
                // coverage:ignore-line
                {
                    // coverage:ignore-line
                    // coverage:ignore-start
                    workflow_run.state = WorkflowRunState::Failed;
                    workflow_run.error = workflow_run
                        .phase_runs
                        .iter()
                        .find_map(|phase| phase.error.clone());
                // coverage:ignore-end
                } else if workflow_run
                    .phase_runs
                    .iter()
                    .any(|phase| phase.state == WorkflowRunState::Cancelled)
                // coverage:ignore-start
                {
                    workflow_run.state = WorkflowRunState::Cancelled;
                // coverage:ignore-end
                } else if workflow_run
                    .phase_runs
                    .iter()
                    .all(|phase| phase.state == WorkflowRunState::Completed)
                // coverage:ignore-line
                {
                    // coverage:ignore-line
                    workflow_run.state = WorkflowRunState::Completed;
                    workflow_run.output = Some(impl_workflows::workflow_run_output(workflow_run));
                } else if workflow_run // coverage:ignore-line
                    .phase_runs
                    .iter()
                    .any(|phase| phase.state == WorkflowRunState::Running)
                // coverage:ignore-start
                {
                    workflow_run.state = WorkflowRunState::Running;
                    // coverage:ignore-end
                }
                updated.push(workflow_run.clone());
            } // coverage:ignore-line
        }
        if !updated.is_empty() {
            self.save_workflow_runs(&workflow_runs)?;
        }
        Ok(updated)
    }

    pub(crate) fn update_schedule_enabled(
        &mut self,
        schedule_id: &str,
        enabled: bool,
    ) -> Result<AppResponse, RuntimeError> {
        let mut schedules = self.schedules()?;
        let schedule = schedules
            .iter_mut()
            .find(|schedule| schedule.schedule_id == schedule_id)
            .ok_or_else(|| RuntimeError::not_found("schedule not found"))?;
        schedule.enabled = enabled;
        schedule.updated_at = unix_millis();
        let saved = schedule.clone();
        self.save_schedules(&schedules)?;
        Ok(value(ScheduleResult { schedule: saved }))
    }

    pub(crate) fn save_metadata_vec<T: Serialize>(
        &mut self,
        key: &str,
        items: &[T],
    ) -> Result<(), RuntimeError> {
        let serialized =
            serde_json::to_string(items).map_err(|err| RuntimeError::storage(err.to_string()))?;
        self.set_metadata_value(key, &serialized)
    }
}
