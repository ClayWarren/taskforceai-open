use serde_json::json;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio::time::{sleep, timeout, Duration};

use crate::ollama::OllamaClient;
use crate::protocol::*;

use crate::runtime::error::RuntimeError;
use crate::runtime::impl_state::log_runtime;
use crate::runtime::models::ollama_model_name;
use crate::runtime::orchestration::*;
use crate::runtime::run_events::*;
use crate::runtime::util::*;

async fn await_hybrid_review(
    mut review: JoinHandle<Result<(HybridLocalReviewer, String), String>>,
    timeout_duration: Duration,
) -> Result<(HybridLocalReviewer, String), String> {
    match timeout(timeout_duration, &mut review).await {
        Ok(Ok(result)) => result,
        Ok(Err(err)) => Err(format!("local reviewer task failed: {err}")),
        Err(_) => {
            review.abort();
            Err("local reviewer timed out".to_string())
        }
    }
}

impl crate::runtime::AppRuntime {
    pub(crate) fn spawn_placeholder_run_worker(&self, run: RunRecord) {
        if !self.config.simulate_run_progress {
            return;
        }
        let Some(sender) = self.event_sender.clone() else {
            return;
        };

        tokio::spawn(async move {
            sleep(Duration::from_millis(20)).await;
            let mut processing = run.clone();
            processing.status = RunStatus::Processing;
            processing.updated_at = unix_millis();
            if sender
                .send(AppServerEvent::RunUpdated {
                    run: Box::new(processing.clone()),
                })
                .await
                .is_err()
            {
                return;
            }

            sleep(Duration::from_millis(20)).await;
            let mut completed = processing;
            completed.status = RunStatus::Completed;
            completed.output = Some("Run accepted by local app-server placeholder.".to_string());
            completed.updated_at = unix_millis();
            let _ = sender
                .send(AppServerEvent::RunUpdated {
                    run: Box::new(completed),
                })
                .await;
        });
    }

    pub(crate) fn spawn_ollama_run_worker(&self, run: RunRecord) {
        let Some(sender) = self.event_sender.clone() else {
            return;
        };
        let base_url = self.config.ollama_base_url.clone();
        tokio::spawn(async move {
            let mut processing = run.clone();
            processing.status = RunStatus::Processing;
            processing.updated_at = unix_millis();
            if sender
                .send(AppServerEvent::RunUpdated {
                    run: Box::new(processing.clone()),
                })
                .await
                .is_err()
            {
                return;
            }

            let model = ollama_model_name(processing.model_id.as_deref());
            let client = OllamaClient::new(base_url.clone());
            let result = match client.ensure_ready(&base_url, Some(&model)).await {
                Ok(_) => client.create_response(&model, &processing.prompt).await,
                Err(err) => Err(err),
            };

            let mut completed = processing;
            completed.updated_at = unix_millis();
            match result {
                Ok(output) => {
                    completed.status = RunStatus::Completed;
                    completed.output = Some(output);
                }
                Err(err) => {
                    completed.status = RunStatus::Failed;
                    completed.error = Some(format!("ollama error: {err}"));
                }
            }
            let _ = sender
                .send(AppServerEvent::RunUpdated {
                    run: Box::new(completed),
                })
                .await;
        });
    }

    pub(crate) async fn dispatch_prompt_queue_record(
        &mut self,
        queued_prompt: &PromptQueueRecord,
    ) -> Result<(RunRecord, Vec<AppServerEvent>), RuntimeError> {
        let response = self
            .run_submit(SubmitRunParams {
                prompt: queued_prompt.prompt.clone(),
                model_id: queued_prompt.model_id.clone(),
                quick_mode: None,
                autonomous: None,
                computer_use: None,
                computer_use_target: None,
                use_logged_in_services: None,
                agent_count: None,
                project_id: None,
                attachment_ids: queued_prompt.attachment_ids.clone(),
                client_mcp_tools: Vec::new(),
                research_workflow: None,
            })
            .await?;
        match response {
            AppResponse::WithEvents { result, events } => {
                let result: SubmitRunResult = serde_json::from_value(result)
                    .map_err(|err| RuntimeError::storage(err.to_string()))?;
                Ok((result.run, events))
            }
            AppResponse::Value(result) => {
                let result: SubmitRunResult = serde_json::from_value(result)
                    .map_err(|err| RuntimeError::storage(err.to_string()))?;
                Ok((result.run, Vec::new()))
            }
            AppResponse::Shutdown(_) => unreachable!("run_submit never shuts down"),
        }
    }

    pub(crate) fn spawn_remote_stream_worker(
        &self,
        token: String,
        run: RunRecord,
        hybrid_reviewer: Option<HybridLocalReviewer>,
    ) {
        let Some(sender) = self.event_sender.clone() else {
            return;
        };
        let api_client = self.api_client.clone();
        tokio::spawn(async move {
            log_runtime(
                "info",
                "remote stream worker starting",
                json!({ "runId": run.id }),
            );
            let mut hybrid_review = hybrid_reviewer.map(|reviewer| {
                let prompt = run.prompt.clone();
                tokio::spawn(async move { run_hybrid_local_review(reviewer, prompt).await })
            });
            let (stream_sender, mut stream_receiver) = mpsc::channel(64);
            let stream_client = api_client.clone();
            let stream_token = token.clone();
            let stream_run_id = run.id.clone();
            let stream_task = tokio::spawn(async move {
                stream_client
                    .stream_run_events_to_sender(&stream_token, &stream_run_id, stream_sender)
                    .await
            });
            let mut streamed = run.clone();
            let mut event_count = 0_u64;
            let mut terminal_seen = false;
            while let Some(event) = stream_receiver.recv().await {
                event_count += 1;
                let event_type = event.event_type.clone();
                streamed = apply_stream_event_to_run(streamed.clone(), event);
                let terminal = matches!(
                    streamed.status,
                    RunStatus::Completed | RunStatus::Failed | RunStatus::Canceled
                );
                if terminal && streamed.status == RunStatus::Completed {
                    if let Some(review) = hybrid_review.take() {
                        let result = await_hybrid_review(review, Duration::from_secs(45)).await;
                        streamed = apply_hybrid_local_review(streamed.clone(), result);
                    }
                }
                if event_count == 1 || terminal {
                    log_runtime(
                        "info",
                        "remote stream event received",
                        json!({
                            "runId": streamed.id,
                            "eventType": event_type,
                            "status": streamed.status,
                            "terminal": terminal,
                            "eventCount": event_count,
                        }),
                    );
                }
                let _ = sender
                    .send(AppServerEvent::RunUpdated {
                        run: Box::new(streamed.clone()),
                    })
                    .await;
                if terminal {
                    terminal_seen = true;
                    break;
                }
            }
            if terminal_seen {
                stream_task.abort();
                log_runtime(
                    "info",
                    "remote stream worker stopped after terminal event",
                    json!({ "runId": streamed.id, "eventCount": event_count }),
                );
                return;
            }
            match stream_task.await {
                Ok(Ok(())) => {
                    if matches!(
                        streamed.status,
                        RunStatus::Completed | RunStatus::Failed | RunStatus::Canceled
                    ) {
                        log_runtime(
                            "info",
                            "remote stream worker stopped",
                            json!({ "runId": streamed.id, "eventCount": event_count }),
                        );
                    } else {
                        streamed.status = RunStatus::Failed;
                        streamed.error =
                            Some("remote stream ended before a terminal event".to_string());
                        streamed.updated_at = unix_millis();
                        log_runtime(
                            "error",
                            "remote stream ended without terminal event",
                            json!({ "runId": streamed.id, "eventCount": event_count }),
                        );
                        let _ = sender
                            .send(AppServerEvent::RunUpdated {
                                run: Box::new(streamed),
                            })
                            .await;
                    }
                }
                Ok(Err(err)) => {
                    let now = unix_millis();
                    let mut failed = run;
                    failed.status = RunStatus::Failed;
                    failed.error = Some(err.to_string());
                    failed.updated_at = now;
                    log_runtime(
                        "error",
                        "remote stream worker failed",
                        json!({ "runId": failed.id, "error": failed.error }),
                    );
                    let _ = sender
                        .send(AppServerEvent::RunUpdated {
                            run: Box::new(failed),
                        })
                        .await;
                }
                Err(err) => {
                    let now = unix_millis();
                    let mut failed = run;
                    failed.status = RunStatus::Failed;
                    failed.error = Some(format!("stream task failed: {err}"));
                    failed.updated_at = now;
                    log_runtime(
                        "error",
                        "remote stream task join failed",
                        json!({ "runId": failed.id, "error": failed.error }),
                    );
                    let _ = sender
                        .send(AppServerEvent::RunUpdated {
                            run: Box::new(failed),
                        })
                        .await;
                }
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use std::future;
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };

    use super::*;

    struct AbortFlag(Arc<AtomicBool>);

    impl Drop for AbortFlag {
        fn drop(&mut self) {
            self.0.store(true, Ordering::SeqCst);
        }
    }

    #[tokio::test]
    async fn await_hybrid_review_aborts_on_timeout() {
        let aborted = Arc::new(AtomicBool::new(false));
        let abort_flag = AbortFlag(aborted.clone());
        let review = tokio::spawn(async move {
            let _abort_flag = abort_flag;
            future::pending::<Result<(HybridLocalReviewer, String), String>>().await
        });

        let result = await_hybrid_review(review, Duration::from_millis(10)).await;
        tokio::task::yield_now().await;

        assert_eq!(result.unwrap_err(), "local reviewer timed out");
        assert!(aborted.load(Ordering::SeqCst));
    }
}
