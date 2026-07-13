use crate::protocol::*;

use super::error::RuntimeError;
use super::format::*;
use super::util::*;

impl super::AppRuntime {
    pub fn computer_use_status(&self) -> AppResponse {
        value(self.computer_use_status_result())
    }

    pub fn browser_status(&self) -> AppResponse {
        value(self.browser_status_result())
    }

    pub fn history_list(&self, params: HistoryListParams) -> AppResponse {
        let limit = params.limit.clamp(1, 200);
        let mut runs = self
            .runs
            .values()
            .filter(|run| !self.private_run_ids.contains(&run.id))
            .cloned()
            .collect::<Vec<_>>();
        runs.sort_by_key(|run| std::cmp::Reverse(run.updated_at));
        runs.truncate(limit);

        value(HistoryListResult { runs })
    }

    pub fn run_search(&self, params: RunSearchParams) -> AppResponse {
        let query = params.query.trim().to_ascii_lowercase();
        let limit = params.limit.clamp(1, 200);
        let mut runs = if query.is_empty() {
            Vec::new()
        } else {
            self.runs
                .values()
                .filter(|run| !self.private_run_ids.contains(&run.id))
                .filter(|run| run_matches_query(run, &query))
                .cloned()
                .collect::<Vec<_>>()
        };
        runs.sort_by_key(|run| std::cmp::Reverse(run.updated_at));
        runs.truncate(limit);

        value(RunSearchResult {
            query: params.query.trim().to_string(),
            runs,
        })
    }

    pub fn usage_summary(&self) -> AppResponse {
        value(self.usage_summary_result())
    }

    pub fn status_summary(&self) -> Result<AppResponse, RuntimeError> {
        Ok(value(self.status_summary_result()?))
    }

    pub(crate) fn status_summary_result(&self) -> Result<StatusSummaryResult, RuntimeError> {
        Ok(StatusSummaryResult {
            transport: "stdio/jsonl".to_string(),
            authenticated: self.auth_token()?.is_some(),
            run_count: self.runs.len().saturating_sub(self.private_run_ids.len()),
            model_id: self
                .default_model_id()?
                .unwrap_or_else(|| "default".to_string()),
            quick_mode: self.quick_mode_enabled()?,
            autonomous: self.autonomous_enabled()?,
            computer_use: self.computer_use_enabled()?,
            pet: self.pet_state()?,
        })
    }

    pub(crate) fn usage_summary_result(&self) -> UsageSummaryResult {
        let mut summary = UsageSummaryResult {
            total_runs: 0,
            completed_runs: 0,
            canceled_runs: 0,
            failed_runs: 0,
            queued_runs: 0,
            processing_runs: 0,
        };
        for run in self
            .runs
            .values()
            .filter(|run| !self.private_run_ids.contains(&run.id))
        {
            summary.total_runs += 1;
            match run.status {
                RunStatus::Completed => summary.completed_runs += 1, // coverage:ignore-line
                RunStatus::Canceled => summary.canceled_runs += 1,
                RunStatus::Failed => summary.failed_runs += 1,
                RunStatus::Queued => summary.queued_runs += 1,
                RunStatus::Processing => summary.processing_runs += 1,
            }
        }
        summary
    }
}
