use serde_json::{json, Value};

use crate::protocol::*;

use super::error::RuntimeError;
use super::util::*;

const MAX_WORKFLOW_CONCURRENCY: u16 = 16;
const MAX_WORKFLOW_PHASE_AGENT_COUNT: u16 = 16;
const MAX_WORKFLOW_PHASES: usize = 64;
const MAX_WORKFLOW_AGENT_DISPATCHES: u32 = 128;

impl super::AppRuntime {
    pub fn workflow_list(&self) -> Result<AppResponse, RuntimeError> {
        Ok(value(WorkflowListResult {
            workflows: self.workflows()?,
        }))
    }

    pub fn workflow_save(
        &mut self,
        params: WorkflowSaveParams,
    ) -> Result<AppResponse, RuntimeError> {
        let mut workflow = params.workflow;
        validate_workflow_definition(&workflow)?;
        let now = unix_millis();
        if workflow.created_at == 0 {
            workflow.created_at = now;
        }
        workflow.updated_at = now;

        let mut workflows = self.workflows()?;
        if let Some(existing) = workflows
            .iter_mut()
            .find(|existing| existing.workflow_id == workflow.workflow_id)
        {
            *existing = workflow.clone();
        } else {
            workflows.push(workflow.clone());
        }
        self.save_workflows(&workflows)?;
        Ok(value(WorkflowResult { workflow }))
    }

    pub fn workflow_get(&self, params: WorkflowIDParams) -> Result<AppResponse, RuntimeError> {
        Ok(value(WorkflowResult {
            workflow: self.find_workflow(&params.workflow_id)?,
        }))
    }

    pub fn workflow_delete(
        &mut self,
        params: WorkflowIDParams,
    ) -> Result<AppResponse, RuntimeError> {
        let mut workflows = self.workflows()?;
        let before = workflows.len();
        workflows.retain(|workflow| workflow.workflow_id != params.workflow_id);
        if workflows.len() == before {
            return Err(RuntimeError::not_found("workflow not found"));
        }
        self.save_workflows(&workflows)?;
        Ok(value(AckResult { ok: true }))
    }

    pub fn workflow_run_list(&self) -> Result<AppResponse, RuntimeError> {
        Ok(value(WorkflowRunListResult {
            runs: self.workflow_runs()?,
        }))
    }

    pub fn workflow_run_get(
        &self,
        params: WorkflowRunIDParams,
    ) -> Result<AppResponse, RuntimeError> {
        Ok(value(WorkflowRunResult {
            run: self.find_workflow_run(&params.run_id)?,
        }))
    }

    pub async fn workflow_run(
        &mut self,
        params: WorkflowRunParams,
    ) -> Result<AppResponse, RuntimeError> {
        let workflow = self.find_workflow(&params.workflow_id)?;
        validate_workflow_definition(&workflow)?;
        let now = unix_millis();
        let phase_runs = workflow
            .phases
            .iter()
            .map(|phase| WorkflowPhaseRunRecord {
                phase_id: phase.phase_id.clone(),
                state: WorkflowRunState::Queued,
                agent_run_ids: Vec::new(),
                result: None,
                error: None,
                started_at: None,
                completed_at: None,
            })
            .collect();
        let mut run = WorkflowRunRecord {
            run_id: format!("workflow-run-{now}-{:016x}", rand::random::<u64>()),
            workflow_id: workflow.workflow_id.clone(),
            workflow_version: workflow.version.clone(),
            state: WorkflowRunState::Queued,
            args: params.args,
            phase_runs,
            agent_run_ids: Vec::new(),
            output: None,
            error: None,
            created_at: now,
            updated_at: now,
        };
        let mut runs = self.workflow_runs()?;
        runs.push(run.clone());
        self.save_workflow_runs(&runs)?;
        let mut events = vec![AppServerEvent::WorkflowRunUpdated {
            run: Box::new(run.clone()),
        }];
        let (started, mut start_events) = self.start_ready_workflow_phases(&workflow, run).await?;
        run = started;
        events.append(&mut start_events);
        Ok(AppResponse::WithEvents {
            result: to_value(WorkflowRunResult { run: run.clone() }),
            events,
        })
    }

    pub fn workflow_run_pause(
        &mut self,
        params: WorkflowRunIDParams,
    ) -> Result<AppResponse, RuntimeError> {
        self.update_workflow_run_state(&params.run_id, WorkflowRunState::Paused)
    }

    pub fn workflow_run_resume(
        &mut self,
        params: WorkflowRunIDParams,
    ) -> Result<AppResponse, RuntimeError> {
        self.update_workflow_run_state(&params.run_id, WorkflowRunState::Running)
    }

    pub fn workflow_run_cancel(
        &mut self,
        params: WorkflowRunIDParams,
    ) -> Result<AppResponse, RuntimeError> {
        self.update_workflow_run_state(&params.run_id, WorkflowRunState::Cancelled)
    }

    pub(crate) async fn advance_ready_workflow_runs(
        &mut self,
    ) -> Result<Vec<AppServerEvent>, RuntimeError> {
        let runs = self.workflow_runs()?;
        let mut events = Vec::new();
        for run in runs {
            if matches!(
                run.state,
                WorkflowRunState::Paused
                    | WorkflowRunState::Completed
                    | WorkflowRunState::Failed
                    | WorkflowRunState::Cancelled
            ) {
                continue;
            }
            let Ok(workflow) = self.find_workflow(&run.workflow_id) else {
                continue;
            };
            let (_run, mut next_events) = self.start_ready_workflow_phases(&workflow, run).await?;
            events.append(&mut next_events);
        }
        Ok(events)
    }

    fn find_workflow_run(&self, run_id: &str) -> Result<WorkflowRunRecord, RuntimeError> {
        self.workflow_runs()?
            .into_iter()
            .find(|run| run.run_id == run_id)
            .ok_or_else(|| RuntimeError::not_found("workflow run not found"))
    }

    fn update_workflow_run_state(
        &mut self,
        run_id: &str,
        state: WorkflowRunState,
    ) -> Result<AppResponse, RuntimeError> {
        let mut runs = self.workflow_runs()?;
        let run = runs
            .iter_mut()
            .find(|run| run.run_id == run_id)
            .ok_or_else(|| RuntimeError::not_found("workflow run not found"))?;
        run.state = state;
        run.updated_at = unix_millis();
        let saved = run.clone();
        self.save_workflow_runs(&runs)?;
        Ok(AppResponse::WithEvents {
            result: to_value(WorkflowRunResult { run: saved.clone() }),
            events: vec![AppServerEvent::WorkflowRunUpdated {
                run: Box::new(saved),
            }],
        })
    }

    async fn start_ready_workflow_phases(
        &mut self,
        workflow: &WorkflowDefinitionRecord,
        mut run: WorkflowRunRecord,
    ) -> Result<(WorkflowRunRecord, Vec<AppServerEvent>), RuntimeError> {
        let mut events = Vec::new();
        let mut changed = false;
        let max_concurrency = workflow
            .budget
            .as_ref()
            .and_then(|budget| budget.max_concurrency)
            .unwrap_or(16)
            .max(1);
        loop {
            let completed = run
                .phase_runs
                .iter()
                .filter(|phase| phase.state == WorkflowRunState::Completed)
                .map(|phase| phase.phase_id.as_str())
                .collect::<std::collections::BTreeSet<_>>();
            let ready_phase_ids = workflow
                .phases
                .iter()
                .filter(|phase| {
                    run.phase_runs
                        .iter()
                        .find(|phase_run| phase_run.phase_id == phase.phase_id)
                        .is_some_and(|phase_run| phase_run.state == WorkflowRunState::Queued)
                })
                .filter(|phase| {
                    phase
                        .depends_on
                        .iter()
                        .all(|dependency| completed.contains(dependency.as_str()))
                })
                .map(|phase| phase.phase_id.clone())
                .collect::<Vec<_>>();

            if ready_phase_ids.is_empty() {
                break;
            }

            let mut completed_local_phase = false;
            run.state = WorkflowRunState::Running;
            for phase_id in ready_phase_ids {
                let phase = workflow
                    .phases
                    .iter()
                    .find(|phase| phase.phase_id == phase_id)
                    .expect("ready phase id should come from workflow");
                let Some(phase_index) = run
                    .phase_runs
                    .iter()
                    .position(|phase_run| phase_run.phase_id == phase.phase_id)
                else {
                    continue; // coverage:ignore-line
                };

                if let Some(prompt) = executable_phase_prompt(workflow, phase, &run.args) {
                    let count = phase_agent_count(phase).min(max_concurrency).max(1);
                    let now = unix_millis();
                    run.phase_runs[phase_index].state = WorkflowRunState::Running;
                    run.phase_runs[phase_index].started_at = Some(now);
                    run.updated_at = now;
                    for ordinal in 0..count {
                        let prompt = phase_prompt_for_agent(&prompt, count, ordinal);
                        let response = self
                            .run_submit(SubmitRunParams {
                                prompt,
                                model_id: None,
                                quick_mode: None,
                                autonomous: None,
                                computer_use: None,
                                computer_use_target: None,
                                use_logged_in_services: None,
                                agent_count: None,
                                project_id: None,
                                attachment_ids: Vec::new(),
                                client_mcp_tools: Vec::new(),
                                research_workflow: None,
                            })
                            .await?;
                        let (result, mut run_events) = submit_run_result_and_events(response)?;
                        run.agent_run_ids.push(result.run.id.clone());
                        run.phase_runs[phase_index]
                            .agent_run_ids
                            .push(result.run.id);
                        events.append(&mut run_events);
                    }
                    changed = true;
                } else {
                    let now = unix_millis();
                    run.phase_runs[phase_index].state = WorkflowRunState::Completed;
                    run.phase_runs[phase_index].started_at = Some(now);
                    run.phase_runs[phase_index].completed_at = Some(now);
                    run.phase_runs[phase_index].result =
                        Some(local_phase_result(workflow, phase, &run));
                    run.updated_at = now;
                    completed_local_phase = true;
                    changed = true;
                }
            }
            if !completed_local_phase {
                break;
            }
        }
        if run
            .phase_runs
            .iter()
            .all(|phase| phase.state == WorkflowRunState::Completed)
        {
            run.state = WorkflowRunState::Completed;
            run.output = Some(workflow_run_output(&run));
            changed = true;
        }
        if !changed {
            return Ok((run, events)); // coverage:ignore-line
        }
        self.replace_workflow_run(run.clone())?;
        events.push(AppServerEvent::WorkflowRunUpdated {
            run: Box::new(run.clone()),
        });
        Ok((run, events))
    }

    pub(crate) fn replace_workflow_run(
        &mut self,
        run: WorkflowRunRecord,
    ) -> Result<(), RuntimeError> {
        let mut runs = self.workflow_runs()?;
        let Some(existing) = runs
            .iter_mut()
            .find(|existing| existing.run_id == run.run_id)
        else {
            return Err(RuntimeError::not_found("workflow run not found"));
        };
        *existing = run;
        self.save_workflow_runs(&runs)
    }
}

fn validate_workflow_definition(workflow: &WorkflowDefinitionRecord) -> Result<(), RuntimeError> {
    if workflow.workflow_id.trim().is_empty() {
        return Err(RuntimeError::invalid_params("workflow id is required"));
    }
    if workflow.name.trim().is_empty() {
        return Err(RuntimeError::invalid_params("workflow name is required"));
    }
    if workflow.version.trim().is_empty() {
        return Err(RuntimeError::invalid_params("workflow version is required"));
    }
    if workflow.phases.is_empty() {
        return Err(RuntimeError::invalid_params(
            "workflow requires at least one phase",
        ));
    }
    if workflow.phases.len() > MAX_WORKFLOW_PHASES {
        return Err(RuntimeError::invalid_params(format!(
            "workflow cannot contain more than {MAX_WORKFLOW_PHASES} phases"
        )));
    }
    let mut phase_ids = std::collections::BTreeSet::new();
    let mut total_agent_dispatches = 0u32;
    for phase in &workflow.phases {
        if phase.phase_id.trim().is_empty() {
            return Err(RuntimeError::invalid_params(
                "workflow phase id is required",
            ));
        }
        if phase.name.trim().is_empty() {
            return Err(RuntimeError::invalid_params(
                "workflow phase name is required",
            ));
        }
        if !phase_ids.insert(phase.phase_id.as_str()) {
            return Err(RuntimeError::invalid_params(
                "workflow phase ids must be unique",
            ));
        }
        if let Some(agent_count) = phase.agent_count {
            if agent_count == 0 {
                return Err(RuntimeError::invalid_params(
                    "workflow phase agent count must be greater than zero",
                ));
            }
            if agent_count > MAX_WORKFLOW_PHASE_AGENT_COUNT {
                return Err(RuntimeError::invalid_params(format!(
                    "workflow phase agent count cannot exceed {MAX_WORKFLOW_PHASE_AGENT_COUNT}"
                )));
            }
        }
        total_agent_dispatches += u32::from(phase_agent_count(phase));
    }
    if total_agent_dispatches > MAX_WORKFLOW_AGENT_DISPATCHES {
        return Err(RuntimeError::invalid_params(format!(
            "workflow cannot dispatch more than {MAX_WORKFLOW_AGENT_DISPATCHES} agent runs"
        )));
    }
    let unknown_deps = workflow
        .phases
        .iter()
        .flat_map(|phase| phase.depends_on.iter())
        .find(|dependency| !phase_ids.contains(dependency.as_str()));
    if let Some(dependency) = unknown_deps {
        return Err(RuntimeError::invalid_params(format!(
            "workflow phase dependency {dependency:?} does not exist"
        )));
    }
    if let Some(budget) = &workflow.budget {
        if budget.max_concurrency == Some(0) {
            return Err(RuntimeError::invalid_params(
                "workflow max concurrency must be greater than zero",
            ));
        }
        if budget
            .max_concurrency
            .is_some_and(|max_concurrency| max_concurrency > MAX_WORKFLOW_CONCURRENCY)
        {
            return Err(RuntimeError::invalid_params(format!(
                "workflow max concurrency cannot exceed {MAX_WORKFLOW_CONCURRENCY}"
            )));
        }
    }
    Ok(())
}

fn executable_phase_prompt(
    workflow: &WorkflowDefinitionRecord,
    phase: &WorkflowPhaseDefinition,
    args: &Value,
) -> Option<String> {
    match phase.kind {
        WorkflowPhaseKind::Prompt
        | WorkflowPhaseKind::Fanout
        | WorkflowPhaseKind::Map
        | WorkflowPhaseKind::Vote
        | WorkflowPhaseKind::Review => {
            let prompt = phase.prompt.as_deref().unwrap_or("").trim();
            if prompt.is_empty() {
                return None;
            }
            Some(format!(
                "Workflow: {}\nPhase: {}\nArgs: {}\n\n{}",
                workflow.name, phase.name, args, prompt
            ))
        }
        WorkflowPhaseKind::Reduce | WorkflowPhaseKind::Gate | WorkflowPhaseKind::Artifact => None,
    }
}

fn phase_agent_count(phase: &WorkflowPhaseDefinition) -> u16 {
    match phase.kind {
        WorkflowPhaseKind::Fanout | WorkflowPhaseKind::Map => phase.agent_count.unwrap_or(2),
        _ => 1,
    }
}

fn phase_prompt_for_agent(prompt: &str, count: u16, ordinal: u16) -> String {
    if count <= 1 {
        return prompt.to_string();
    }
    format!("{prompt}\n\nShard: {} of {}", ordinal + 1, count)
}

pub(crate) fn workflow_run_output(run: &WorkflowRunRecord) -> Value {
    json!({
        "workflowId": run.workflow_id,
        "workflowVersion": run.workflow_version,
        "phaseCount": run.phase_runs.len(),
        "agentRunIds": run.agent_run_ids,
    })
}

fn local_phase_result(
    workflow: &WorkflowDefinitionRecord,
    phase: &WorkflowPhaseDefinition,
    run: &WorkflowRunRecord,
) -> Value {
    let dependencies = phase
        .depends_on
        .iter()
        .filter_map(|dependency| {
            run.phase_runs
                .iter()
                .find(|phase_run| &phase_run.phase_id == dependency)
        })
        .map(|phase_run| {
            json!({
                "phaseId": phase_run.phase_id,
                "result": phase_run.result,
                "agentRunIds": phase_run.agent_run_ids,
            })
        })
        .collect::<Vec<_>>();
    json!({
        "workflowId": workflow.workflow_id,
        "phaseId": phase.phase_id,
        "kind": phase.kind,
        "dependencies": dependencies,
        "message": "Completed locally without agent execution."
    })
}
