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

async fn send_run_update(
    sender: &mpsc::Sender<AppServerEvent>,
    run: RunRecord,
    context: &str,
) -> bool {
    let run_id = run.id.clone();
    if sender
        .send(AppServerEvent::RunUpdated { run: Box::new(run) })
        .await
        .is_ok()
    {
        return true;
    }

    log_runtime(
        "warn",
        "failed to deliver run update",
        json!({ "runId": run_id, "context": context }),
    );
    false
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
            if !send_run_update(&sender, processing.clone(), "placeholder processing").await {
                return; // coverage:ignore-line
            }

            sleep(Duration::from_millis(20)).await;
            let mut completed = processing;
            completed.status = RunStatus::Completed;
            completed.output = Some("Run accepted by local app-server placeholder.".to_string());
            completed.updated_at = unix_millis();
            send_run_update(&sender, completed, "placeholder completed").await;
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
            if !send_run_update(&sender, processing.clone(), "ollama processing").await {
                return; // coverage:ignore-line
            }

            let model = ollama_model_name(processing.model_id.as_deref());
            let client = OllamaClient::new(base_url.clone());
            let result = match client.ensure_ready(&base_url, Some(&model)).await {
                Ok(_) => client.create_response(&model, &processing.prompt).await, // coverage:ignore-line
                Err(err) => Err(err),
            };

            let mut completed = processing;
            completed.updated_at = unix_millis();
            match result {
                // coverage:ignore-start
                Ok(output) => {
                    completed.status = RunStatus::Completed;
                    completed.output = Some(output);
                }
                // coverage:ignore-end
                Err(err) => {
                    completed.status = RunStatus::Failed;
                    completed.error = Some(format!("ollama error: {err}"));
                }
            }
            send_run_update(&sender, completed, "ollama completed").await;
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
                reasoning_effort: queued_prompt.reasoning_effort.clone(),
                quick_mode: None,
                autonomous: None,
                computer_use: None,
                computer_use_target: None,
                use_logged_in_services: None,
                agent_count: None,
                project_id: None,
                attachment_ids: queued_prompt.attachment_ids.clone(),
                client_mcp_tools: Vec::new(),
                private_chat: false,
                research_workflow: None,
            })
            .await?;
        match response {
            AppResponse::WithEvents { result, events } => {
                let result: SubmitRunResult = serde_json::from_value(result)
                    .map_err(|err| RuntimeError::storage(err.to_string()))?;
                Ok((result.run, events)) // coverage:ignore-line
            } // coverage:ignore-line
            // coverage:ignore-start
            AppResponse::Value(result) => {
                let result: SubmitRunResult = serde_json::from_value(result)
                    .map_err(|err| RuntimeError::storage(err.to_string()))?;
                Ok((result.run, Vec::new()))
                // coverage:ignore-end
            }
            AppResponse::Shutdown(_) => unreachable!("run_submit never shuts down"), // coverage:ignore-line
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
                    // coverage:ignore-line
                    if let Some(review) = hybrid_review.take() {
                        let result = await_hybrid_review(review, Duration::from_secs(45)).await;
                        streamed = apply_hybrid_local_review(streamed.clone(), result);
                    } // coverage:ignore-line
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
                        }), // coverage:ignore-line
                    ); // coverage:ignore-line
                }
                if !send_run_update(&sender, streamed.clone(), "remote stream event").await {
                    // coverage:ignore-start
                    stream_task.abort();
                    return;
                    // coverage:ignore-end
                }
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
            } // coverage:ignore-line
            match stream_task.await {
                // coverage:ignore-line
                Ok(Ok(())) => {
                    // coverage:ignore-line
                    if matches!(
                        // coverage:ignore-line
                        streamed.status, // coverage:ignore-line
                        RunStatus::Completed | RunStatus::Failed | RunStatus::Canceled // coverage:ignore-start
                    ) {
                        log_runtime(
                            "info",
                            "remote stream worker stopped",
                            json!({ "runId": streamed.id, "eventCount": event_count }),
                        );
                    } else {
                        // coverage:ignore-end
                        streamed.status = RunStatus::Failed;
                        streamed.error =
                            Some("remote stream ended before a terminal event".to_string());
                        streamed.updated_at = unix_millis();
                        log_runtime(
                            "error",
                            "remote stream ended without terminal event",
                            json!({ "runId": streamed.id, "eventCount": event_count }),
                        );
                        send_run_update(&sender, streamed, "remote stream missing terminal").await;
                    }
                }
                Ok(Err(err)) => {
                    let now = unix_millis();
                    streamed.status = RunStatus::Failed;
                    streamed.error = Some(err.to_string());
                    streamed.updated_at = now;
                    log_runtime(
                        // coverage:ignore-line
                        "error",                       // coverage:ignore-line
                        "remote stream worker failed", // coverage:ignore-line
                        json!({ "runId": streamed.id, "error": streamed.error }), // coverage:ignore-line
                    ); // coverage:ignore-line
                    send_run_update(&sender, streamed, "remote stream failure").await;
                    // coverage:ignore-line
                } // coverage:ignore-line
                // coverage:ignore-start
                Err(err) => {
                    let now = unix_millis();
                    streamed.status = RunStatus::Failed;
                    streamed.error = Some(format!("stream task failed: {err}"));
                    streamed.updated_at = now;
                    log_runtime(
                        "error",
                        "remote stream task join failed",
                        json!({ "runId": streamed.id, "error": streamed.error }),
                        // coverage:ignore-end
                    );
                    send_run_update(&sender, streamed, "remote stream join failure").await;
                    // coverage:ignore-line
                }
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use std::future;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };
    use std::thread;

    use super::*;
    use crate::RuntimeConfig;

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

    #[tokio::test]
    async fn await_hybrid_review_reports_success_and_join_failure() {
        let reviewer = HybridLocalReviewer {
            role: "Skeptic".to_string(),
            model_id: "ollama:gpt-oss".to_string(),
            base_url: "http://127.0.0.1:9".to_string(),
        };
        let review = tokio::spawn(async move { Ok((reviewer, "looks good".to_string())) });

        let (reviewer, output) = await_hybrid_review(review, Duration::from_secs(1))
            .await
            .expect("review should complete");
        assert_eq!(reviewer.role, "Skeptic");
        assert_eq!(output, "looks good");

        let review = tokio::spawn(future::pending::<
            Result<(HybridLocalReviewer, String), String>,
        >());
        review.abort();
        let err = await_hybrid_review(review, Duration::from_secs(1))
            .await
            .unwrap_err();
        assert!(err.contains("local reviewer task failed"));
    }

    #[tokio::test]
    async fn send_run_update_reports_delivery_success_and_closed_receivers() {
        let run = run_record("run-send", RunStatus::Queued);
        let (sender, mut receiver) = mpsc::channel(1);

        assert!(send_run_update(&sender, run.clone(), "success").await);
        let event = receiver.recv().await.expect("event should arrive");
        assert!(matches!(event, AppServerEvent::RunUpdated { .. }));

        drop(receiver);
        assert!(!send_run_update(&sender, run, "closed").await);
    }

    #[tokio::test]
    async fn placeholder_run_worker_respects_disabled_and_missing_sender_then_emits_progress() {
        let disabled = crate::runtime::AppRuntime::new(RuntimeConfig::default());
        disabled.spawn_placeholder_run_worker(run_record("disabled", RunStatus::Queued));

        let missing_sender = crate::runtime::AppRuntime::new(RuntimeConfig {
            simulate_run_progress: true,
            ..RuntimeConfig::default()
        });
        missing_sender
            .spawn_placeholder_run_worker(run_record("missing-sender", RunStatus::Queued));

        let (sender, mut receiver) = mpsc::channel(2);
        let mut runtime = crate::runtime::AppRuntime::new(RuntimeConfig {
            simulate_run_progress: true,
            ..RuntimeConfig::default()
        });
        runtime.set_event_sender(sender);
        runtime.spawn_placeholder_run_worker(run_record("placeholder", RunStatus::Queued));

        let processing = next_run_update(&mut receiver).await;
        assert_eq!(processing.status, RunStatus::Processing);
        let completed = next_run_update(&mut receiver).await;
        assert_eq!(completed.status, RunStatus::Completed);
        assert_eq!(
            completed.output.as_deref(),
            Some("Run accepted by local app-server placeholder.")
        );
    }

    #[tokio::test]
    async fn ollama_run_worker_emits_processing_then_failure_for_unreachable_base_url() {
        let (sender, mut receiver) = mpsc::channel(2);
        let mut runtime = crate::runtime::AppRuntime::new(RuntimeConfig {
            ollama_base_url: "http://127.0.0.1:9".to_string(),
            ..RuntimeConfig::default()
        });
        runtime.spawn_ollama_run_worker(run_record("no-sender", RunStatus::Queued));
        runtime.set_event_sender(sender);
        runtime.spawn_ollama_run_worker(RunRecord {
            model_id: Some("ollama:gpt-oss".to_string()),
            ..run_record("ollama", RunStatus::Queued)
        });

        let processing = next_run_update(&mut receiver).await;
        assert_eq!(processing.status, RunStatus::Processing);
        let failed = next_run_update(&mut receiver).await;
        assert_eq!(failed.status, RunStatus::Failed);
        assert!(
            failed
                .error
                .as_deref()
                .unwrap_or_default()
                .contains("ollama error"),
            "unexpected error: {:?}",
            failed.error
        );
    }

    #[tokio::test]
    async fn remote_stream_worker_applies_terminal_events_and_hybrid_review_result() {
        let (base_url, server) = start_stream_server(
            200,
            "data: {\"type\":\"progress\",\"chunk\":\"working\"}\n\n\
             data: {\"type\":\"complete\",\"message\":\"done\"}\n\n",
        );
        let (sender, mut receiver) = mpsc::channel(4);
        let mut runtime = crate::runtime::AppRuntime::new(RuntimeConfig {
            api_base_url: base_url,
            ..RuntimeConfig::default()
        });
        runtime.spawn_remote_stream_worker(
            "token".to_string(),
            run_record("no-sender", RunStatus::Queued),
            None,
        );
        runtime.set_event_sender(sender);
        runtime.spawn_remote_stream_worker(
            "token".to_string(),
            run_record("remote-complete", RunStatus::Queued),
            Some(HybridLocalReviewer {
                role: "Skeptic".to_string(),
                model_id: "ollama:gpt-oss".to_string(),
                base_url: "http://127.0.0.1:9".to_string(),
            }),
        );

        let processing = next_run_update(&mut receiver).await;
        assert_eq!(processing.status, RunStatus::Processing);
        assert_eq!(processing.output.as_deref(), Some("working"));

        let completed = next_run_update(&mut receiver).await;
        assert_eq!(completed.status, RunStatus::Completed);
        assert!(
            completed
                .tool_events
                .iter()
                .any(|event| event["toolName"] == "hybrid.localReviewer"),
            "hybrid review result should be attached: {:?}",
            completed.tool_events
        );
        server.join().expect("stream server should finish");
    }

    #[tokio::test]
    async fn remote_stream_worker_marks_missing_terminal_streams_failed() {
        let (base_url, server) = start_stream_server(
            200,
            "data: {\"type\":\"progress\",\"chunk\":\"partial\"}\n\n",
        );
        let (sender, mut receiver) = mpsc::channel(4);
        let mut runtime = crate::runtime::AppRuntime::new(RuntimeConfig {
            api_base_url: base_url,
            ..RuntimeConfig::default()
        });
        runtime.set_event_sender(sender);
        runtime.spawn_remote_stream_worker(
            "token".to_string(),
            run_record("remote-missing-terminal", RunStatus::Queued),
            None,
        );

        let processing = next_run_update(&mut receiver).await;
        assert_eq!(processing.status, RunStatus::Processing);

        let failed = next_run_update(&mut receiver).await;
        assert_eq!(failed.status, RunStatus::Failed);
        assert_eq!(
            failed.error.as_deref(),
            Some("remote stream ended before a terminal event")
        );
        server.join().expect("stream server should finish");
    }

    #[tokio::test]
    async fn remote_stream_worker_marks_api_stream_errors_failed() {
        let (base_url, server) = start_stream_server(500, "stream failed");
        let (sender, mut receiver) = mpsc::channel(2);
        let mut runtime = crate::runtime::AppRuntime::new(RuntimeConfig {
            api_base_url: base_url,
            ..RuntimeConfig::default()
        });
        runtime.set_event_sender(sender);
        runtime.spawn_remote_stream_worker(
            "token".to_string(),
            run_record("remote-status-error", RunStatus::Queued),
            None,
        );

        let failed = next_run_update(&mut receiver).await;
        assert_eq!(failed.status, RunStatus::Failed);
        assert!(
            failed.error.as_deref().unwrap_or_default().contains("500"),
            "unexpected stream error: {:?}",
            failed.error
        );
        server.join().expect("stream server should finish");
    }

    #[tokio::test]
    async fn remote_stream_worker_preserves_progress_when_stream_errors() {
        let (base_url, server) = start_stream_server(
            200,
            "data: {\"type\":\"progress\",\"chunk\":\"partial\"}\n\n\
             data: not-json\n\n",
        );
        let (sender, mut receiver) = mpsc::channel(4);
        let mut runtime = crate::runtime::AppRuntime::new(RuntimeConfig {
            api_base_url: base_url,
            ..RuntimeConfig::default()
        });
        runtime.set_event_sender(sender);
        runtime.spawn_remote_stream_worker(
            "token".to_string(),
            run_record("remote-stream-error", RunStatus::Queued),
            None,
        );

        let processing = next_run_update(&mut receiver).await;
        assert_eq!(processing.status, RunStatus::Processing);
        assert_eq!(processing.output.as_deref(), Some("partial"));

        let failed = next_run_update(&mut receiver).await;
        assert_eq!(failed.status, RunStatus::Failed);
        assert_eq!(failed.output.as_deref(), Some("partial"));
        assert!(
            failed
                .error
                .as_deref()
                .unwrap_or_default()
                .contains("expected"),
            "unexpected stream error: {:?}",
            failed.error
        );
        server.join().expect("stream server should finish");
    }

    fn run_record(id: &str, status: RunStatus) -> RunRecord {
        RunRecord {
            id: id.to_string(),
            prompt: "Summarize the plan".to_string(),
            model_id: None,
            project_id: None,
            status,
            output: None,
            error: None,
            created_at: 1,
            updated_at: 1,
            tool_events: Vec::new(),
            sources: Vec::new(),
            agent_statuses: Vec::new(),
            pending_approval: None,
        }
    }

    async fn next_run_update(receiver: &mut mpsc::Receiver<AppServerEvent>) -> RunRecord {
        match timeout(Duration::from_secs(2), receiver.recv())
            .await
            .expect("run update should arrive before timeout")
            .expect("event channel should stay open")
        {
            AppServerEvent::RunUpdated { run } => *run,
            other => panic!("expected run update, got {other:?}"),
        }
    }

    fn start_stream_server(status: u16, body: &'static str) -> (String, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("stream server should bind");
        let address = listener.local_addr().expect("address should be readable");
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("stream client should connect");
            let mut request = [0_u8; 2048];
            let _ = stream
                .read(&mut request)
                .expect("request should be readable");
            let status_text = if status == 200 { "OK" } else { "Error" };
            let content_type = if status == 200 {
                "text/event-stream"
            } else {
                "text/plain"
            };
            let response = format!(
                "HTTP/1.1 {status} {status_text}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            stream
                .write_all(response.as_bytes())
                .expect("response should write");
        });
        (format!("http://{address}"), handle)
    }
}
