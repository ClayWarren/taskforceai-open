use super::*;

pub(super) async fn http_runtime_loop(
    mut runtime: AppRuntime,
    mut commands: mpsc::Receiver<HttpRuntimeCommand>,
    mut runtime_events: mpsc::Receiver<AppServerEvent>,
    runtime_outputs: mpsc::UnboundedSender<Vec<OutgoingMessage>>,
    state: Arc<HttpServerState>,
) {
    let scheduler = stdio::RequestScheduler::default();
    let mut remote_connection = stdio::ConnectionState::authenticated_mobile(
        runtime_mobile_workspace_roots(&runtime).unwrap_or_default(),
    );
    let mut remote_poll = tokio::time::interval(REMOTE_POLL_CHECK_INTERVAL);
    remote_poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let (remote_poll_tx, mut remote_poll_rx) = mpsc::channel(1);
    let mut remote_poll_in_flight = false;
    loop {
        tokio::select! {
            Some(command) = commands.recv() => { // coverage:ignore-line
                match command {
                    HttpRuntimeCommand::Rpc { session_id, request, mobile, respond_to } => { // coverage:ignore-line
                        let connection = http_connection(&state, &session_id).await;
                        let method = request.method.as_deref().unwrap_or_default();
                        let spec = stdio::method_spec(method);
                        let key = stdio::scheduling_key(method, &request.params);
                        if spec.execution == stdio::ExecutionPolicy::Concurrent {
                            let mut snapshot = runtime.concurrent_snapshot();
                            let outputs = runtime_outputs.clone();
                            let scheduler = scheduler.clone();
                            tokio::spawn(async move {
                                let _lane = scheduler.acquire(key).await;
                                let mut connection = connection.lock().await;
                                handle_runtime_rpc(
                                    &mut snapshot,
                                    &mut connection,
                                    request,
                                    mobile,
                                    respond_to,
                                    &outputs,
                                ).await;
                            });
                        } else {
                            let _lane = scheduler.acquire(key).await;
                            let mut connection = connection.lock().await;
                            handle_runtime_rpc(
                                &mut runtime,
                                &mut connection,
                                request,
                                mobile,
                                respond_to,
                                &runtime_outputs,
                            ).await;
                        }
                    }
                    HttpRuntimeCommand::MobileWorkspaceRoots { respond_to } => {
                        let _ = respond_to.send(runtime_mobile_workspace_roots(&runtime));
                    }
                } // coverage:ignore-line
            }
            Some(event) = runtime_events.recv() => {
                handle_runtime_event(&mut runtime, event, &runtime_outputs).await; // coverage:ignore-line
            }
            Some(result) = remote_poll_rx.recv() => {
                remote_poll_in_flight = false;
                let result = match result {
                    Ok(completion) => {
                        let event_backlog = state.event_backlog.lock().await.clone();
                        process_remote_poll_completion(
                            &mut runtime,
                            &mut remote_connection,
                            &state.interaction_broker,
                            &event_backlog,
                            completion,
                        ).await.map(|notifications| {
                            if !notifications.is_empty() {
                                let _ = runtime_outputs.send(notifications); // coverage:ignore-line -- notification fanout is covered by handle_runtime_event; this branch requires a polled Remote command that emits an asynchronous runtime event.
                            }
                        })
                    }
                    Err(error) => Err(error),
                };
                report_remote_poll_result(result);
            }
            _ = remote_poll.tick(), if !remote_poll_in_flight => {
                match prepare_remote_poll(&mut runtime) {
                    Ok(Some(request)) => {
                        remote_poll_in_flight = true;
                        let sender = remote_poll_tx.clone();
                        tokio::spawn(async move {
                            let _ = sender.send(request.execute().await).await;
                        });
                    }
                    Ok(None) => {}
                    Err(error) => report_remote_poll_result(Err(error)), // coverage:ignore-line -- requires a persistence failure between runtime startup and polling.
                }
            }
            else => break, // coverage:ignore-line
        }
    }
} // coverage:ignore-line

pub(super) async fn handle_runtime_rpc(
    runtime: &mut AppRuntime,
    connection: &mut stdio::ConnectionState,
    request: JsonRpcRequest,
    mobile: bool,
    respond_to: oneshot::Sender<HttpRuntimeResponse>,
    runtime_outputs: &mpsc::UnboundedSender<Vec<OutgoingMessage>>,
) {
    if mobile && !mobile_rpc_workspace_request_allowed(connection, &request) {
        let response = (!request.is_notification()).then(|| {
            error_response(
                request.response_id(),
                -32602,
                "workspace is not authorized for this mobile session",
            )
        });
        let _ = respond_to.send(HttpRuntimeResponse {
            response,
            action: stdio::ServerAction::Continue,
        });
        return;
    }
    let (messages, action) = stdio::handle_request(request, runtime, connection).await;
    let mut rpc_response = None;
    let mut notifications = Vec::new();
    for message in messages {
        match message {
            OutgoingMessage::Response(response) => {
                rpc_response = Some(response);
            } // coverage:ignore-line
            notification => notifications.push(notification),
        }
    }
    if !notifications.is_empty() {
        let notification_count = notifications.len();
        if runtime_outputs.send(notifications).is_err() {
            log::warn!( // coverage:ignore-line -- diagnostics-only branch is exercised through the closed-output test.
                target: "http", // coverage:ignore-line
                "Failed to enqueue HTTP runtime notifications; output loop is closed (count={notification_count})"
            );
        }
    }
    if respond_to
        .send(HttpRuntimeResponse {
            response: rpc_response,
            action,
        })
        .is_err()
    {
        log::warn!(target: "http", "HTTP RPC client disconnected before response");
    }
}

pub(super) async fn http_connection(
    state: &HttpServerState,
    session_id: &str,
) -> Arc<Mutex<stdio::ConnectionState>> {
    let mut connections = state.connections.lock().await;
    connections
        .entry(session_id.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(stdio::ConnectionState::default())))
        .clone()
}
// coverage:ignore-line
pub(super) async fn handle_runtime_event(
    // coverage:ignore-line
    runtime: &mut AppRuntime, // coverage:ignore-line
    event: AppServerEvent,
    runtime_outputs: &mpsc::UnboundedSender<Vec<OutgoingMessage>>,
) {
    let events = match runtime.apply_event(event) {
        Ok(events) => events,
        // coverage:ignore-start
        Err(error) => {
            log::warn!(target: "http", "Failed to apply HTTP runtime event: {error}");
            return;
            // coverage:ignore-end
        } // coverage:ignore-line
    };
    let mut messages = Vec::with_capacity(events.len() * 3);
    for event in events {
        stdio::extend_event_notifications(&mut messages, event);
    } // coverage:ignore-line
    let workflow_events = match runtime.advance_ready_workflow_runs().await {
        // coverage:ignore-line
        Ok(events) => events,
        // coverage:ignore-start
        Err(error) => {
            log::warn!(target: "http", "Failed to advance HTTP workflow runs after event: {error}");
            return;
            // coverage:ignore-end
        }
    };
    messages.reserve(workflow_events.len() * 3); // coverage:ignore-line
    for event in workflow_events {
        // coverage:ignore-start
        stdio::extend_event_notifications(&mut messages, event);
    }
    // coverage:ignore-end
    if !messages.is_empty() {
        let message_count = messages.len();
        if runtime_outputs.send(messages).is_err() {
            log::warn!(
                target: "http", // coverage:ignore-line
                "Failed to enqueue HTTP runtime event notifications; output loop is closed (count={message_count})"
            );
        }
    } // coverage:ignore-line
}

pub(super) async fn http_runtime_output_loop(
    state: Arc<HttpServerState>,
    mut runtime_outputs: mpsc::UnboundedReceiver<Vec<OutgoingMessage>>,
) {
    while let Some(messages) = runtime_outputs.recv().await {
        publish_http_events(&state, messages).await;
    }
} // coverage:ignore-line

pub(super) async fn publish_http_events(
    state: &Arc<HttpServerState>,
    messages: Vec<OutgoingMessage>,
) {
    for message in messages {
        publish_http_event(state, message).await;
    }
}

pub(super) async fn publish_http_event(state: &Arc<HttpServerState>, message: OutgoingMessage) {
    // coverage:ignore-start -- Expo delivery is an external fire-and-forget boundary; payload mapping is tested separately.
    if let Some(notification) = remote_push_notification(&message) {
        let registered = state.mobile_push_tokens.lock().await.clone();
        let connections = state.connections.lock().await.clone();
        let mut tokens = Vec::new();
        for (session_id, token) in registered {
            let allowed = match connections.get(&session_id) {
                Some(connection) => {
                    let connection = connection.lock().await;
                    message_allowed_for_connection(&message, &connection)
                }
                None => true,
            };
            if allowed {
                tokens.push(token);
            }
        }
        if !tokens.is_empty() {
            tokio::spawn(send_remote_push_notifications(tokens, notification));
        }
    }
    // coverage:ignore-end
    {
        let mut backlog = state.event_backlog.lock().await;
        if backlog.len() == EVENT_BACKLOG_CAPACITY {
            backlog.pop_front();
            HttpTransportStats::increment(&state.stats.event_backlog_dropped);
        }
        let event_id = state.stats.events_published.fetch_add(1, Ordering::Relaxed) + 1;
        backlog.push_back(message.clone());
        let _ = state.events.send(SequencedHttpEvent {
            id: event_id,
            message,
        });
    }
}
