use std::collections::BTreeMap;

use serde_json::{json, Value};
use taskforceai_app_protocol::{
    CommandApprovalParams, FileChangeApprovalParams, JsonRpcServerRequest, McpElicitationParams,
    PermissionApprovalParams, UserInputAnswer, UserInputParams, UserInputQuestion,
    UserInputResponse,
};

use super::AppState;

#[derive(Debug, Clone)]
pub struct InteractionOption {
    pub label: String,
    pub description: String,
    pub value: String,
}

#[derive(Debug, Clone)]
pub enum InteractionKind {
    Approval,
    UserInput {
        questions: Vec<UserInputQuestion>,
        question_index: usize,
        answers: BTreeMap<String, UserInputAnswer>,
    },
    McpElicitation {
        mode: String,
        schema: Option<Value>,
    },
}

#[derive(Debug, Clone)]
pub struct PendingInteraction {
    pub request_id: Value,
    pub method: String,
    pub title: String,
    pub message: String,
    pub options: Vec<InteractionOption>,
    pub selected_index: usize,
    pub scroll_offset: u16,
    pub input: String,
    pub kind: InteractionKind,
}

impl PendingInteraction {
    pub fn from_request(request: JsonRpcServerRequest) -> Result<Self, String> {
        let request_id = request.id;
        let method = request.method;
        match method.as_str() {
            "item/commandExecution/requestApproval" => {
                let params: CommandApprovalParams = decode_params(&method, request.params)?;
                let command = params
                    .command
                    .as_ref()
                    .map(format_value)
                    .unwrap_or_else(|| "Command details unavailable".to_string());
                let cwd = params
                    .cwd
                    .as_deref()
                    .map(|cwd| format!("\nWorking directory: {cwd}"))
                    .unwrap_or_default();
                Ok(Self::approval(
                    request_id,
                    method,
                    "Command approval",
                    format!("{}\n{command}{cwd}", params.reason.unwrap_or_default()),
                ))
            }
            "item/fileChange/requestApproval" => {
                let params: FileChangeApprovalParams = decode_params(&method, request.params)?;
                Ok(Self::approval(
                    request_id,
                    method,
                    "File change approval",
                    format!(
                        "{}\n{}",
                        params.reason.unwrap_or_default(),
                        params
                            .changes
                            .iter()
                            .map(format_value)
                            .collect::<Vec<_>>()
                            .join("\n")
                    ),
                ))
            }
            "item/permissions/requestApproval" => {
                let params: PermissionApprovalParams = decode_params(&method, request.params)?;
                Ok(Self::approval(
                    request_id,
                    method,
                    "Permission request",
                    format!(
                        "{}\n{}",
                        params.reason.unwrap_or_default(),
                        format_value(&params.permissions)
                    ),
                ))
            }
            "item/tool/requestUserInput" => {
                let params: UserInputParams = decode_params(&method, request.params)?;
                if params.questions.is_empty() {
                    return Err("request_user_input contained no questions".to_string());
                }
                let mut interaction = Self {
                    request_id,
                    method,
                    title: "Question".to_string(),
                    message: String::new(),
                    options: Vec::new(),
                    selected_index: 0,
                    scroll_offset: 0,
                    input: String::new(),
                    kind: InteractionKind::UserInput {
                        questions: params.questions,
                        question_index: 0,
                        answers: BTreeMap::new(),
                    },
                };
                interaction.load_current_question();
                Ok(interaction)
            }
            "mcpServer/elicitation/request" => {
                let params: McpElicitationParams = decode_params(&method, request.params)?;
                let mut message = params.message;
                if let Some(url) = params.url {
                    message.push_str(&format!("\n{url}"));
                }
                Ok(Self {
                    request_id,
                    method,
                    title: format!("MCP request · {}", params.server_name),
                    message,
                    options: vec![
                        option("Accept", "Provide the requested information", "accept"),
                        option("Decline", "Continue without providing it", "decline"),
                        option("Cancel", "Cancel this MCP interaction", "cancel"),
                    ],
                    selected_index: 0,
                    scroll_offset: 0,
                    input: String::new(),
                    kind: InteractionKind::McpElicitation {
                        mode: params.mode,
                        schema: params.requested_schema,
                    },
                })
            }
            _ => Err(format!("unsupported server request method `{method}`")),
        }
    }

    fn approval(
        request_id: Value,
        method: String,
        title: impl Into<String>,
        message: String,
    ) -> Self {
        Self {
            request_id,
            method,
            title: title.into(),
            message: message.trim().to_string(),
            options: vec![
                option("Allow once", "Approve only this request", "accept"),
                option(
                    "Allow for session",
                    "Approve matching requests for this session",
                    "acceptForSession",
                ),
                option("Decline", "Reject this request", "decline"),
                option("Cancel", "Cancel the active operation", "cancel"),
            ],
            selected_index: 0,
            scroll_offset: 0,
            input: String::new(),
            kind: InteractionKind::Approval,
        }
    }

    pub fn selected_option(&self) -> Option<&InteractionOption> {
        self.options.get(self.selected_index)
    }

    pub fn accepts_text(&self) -> bool {
        match &self.kind {
            InteractionKind::UserInput {
                questions,
                question_index,
                ..
            } => questions
                .get(*question_index)
                .is_some_and(|question| question.options.is_empty()),
            InteractionKind::McpElicitation { mode, .. } => {
                mode == "form"
                    && self
                        .selected_option()
                        .is_some_and(|option| option.value == "accept")
            }
            InteractionKind::Approval => false,
        }
    }

    fn load_current_question(&mut self) {
        let InteractionKind::UserInput {
            questions,
            question_index,
            ..
        } = &self.kind
        else {
            return;
        };
        let Some(question) = questions.get(*question_index) else {
            return;
        };
        self.title = format!(
            "{} · {} of {}",
            question.header,
            question_index + 1,
            questions.len()
        );
        self.message = question.question.clone();
        self.options = question
            .options
            .iter()
            .map(|item| InteractionOption {
                label: item.label.clone(),
                description: item.description.clone(),
                value: item.label.clone(),
            })
            .collect();
        self.selected_index = 0;
        self.scroll_offset = 0;
        self.input.clear();
    }
}

impl AppState {
    pub fn interaction_active(&self) -> bool {
        self.pending_interaction.is_some()
    }

    pub fn open_interaction(&mut self, request: JsonRpcServerRequest) -> Result<(), String> {
        let interaction = PendingInteraction::from_request(request)?;
        if let Some(active) = &self.pending_interaction {
            let active_title = active.title.clone();
            self.queued_interactions.push_back(interaction);
            self.status_line = format!(
                "Action required: {} ({} queued)",
                active_title,
                self.queued_interactions.len()
            );
        } else {
            self.status_line = format!("Action required: {}", interaction.title);
            self.pending_interaction = Some(interaction);
        }
        Ok(())
    }

    pub fn move_interaction_selection(&mut self, delta: isize) {
        let Some(interaction) = &mut self.pending_interaction else {
            return;
        };
        if interaction.options.is_empty() {
            return;
        }
        let last = interaction.options.len().saturating_sub(1) as isize;
        interaction.selected_index =
            (interaction.selected_index as isize + delta).clamp(0, last) as usize;
    }

    pub fn scroll_interaction(&mut self, delta: isize) {
        let Some(interaction) = &mut self.pending_interaction else {
            return;
        };
        interaction.scroll_offset = interaction
            .scroll_offset
            .saturating_add_signed(delta as i16);
    }

    pub fn append_interaction_input(&mut self, character: char) {
        let Some(interaction) = &mut self.pending_interaction else {
            return;
        };
        if interaction.accepts_text() && !character.is_control() {
            interaction.input.push(character);
        }
    }

    pub fn paste_interaction_input(&mut self, value: &str) {
        let Some(interaction) = &mut self.pending_interaction else {
            return;
        };
        if interaction.accepts_text() {
            interaction.input.push_str(value);
        }
    }

    pub fn backspace_interaction_input(&mut self) {
        let Some(interaction) = &mut self.pending_interaction else {
            return;
        };
        if interaction.accepts_text() {
            interaction.input.pop();
        }
    }

    pub fn cancel_interaction(&mut self) -> Option<(Value, Value)> {
        let interaction = self.pending_interaction.take()?;
        let response = match interaction.kind {
            InteractionKind::Approval => json!({"decision": "cancel"}),
            InteractionKind::McpElicitation { .. } => json!({"action": "cancel"}),
            InteractionKind::UserInput { .. } => json!({"answers": {}}),
        };
        self.activate_next_interaction("Interaction canceled");
        Some((interaction.request_id, response))
    }

    pub fn submit_interaction(&mut self) -> Result<Option<(Value, Value)>, String> {
        let Some(mut interaction) = self.pending_interaction.take() else {
            return Ok(None);
        };
        let selected_value = interaction
            .selected_option()
            .map(|option| option.value.clone());
        let input = interaction.input.trim().to_string();
        let mcp_content = match &interaction.kind {
            InteractionKind::McpElicitation { mode, schema }
                if selected_value.as_deref() == Some("accept") && mode == "form" =>
            {
                if input.is_empty() {
                    schema.as_ref().map(|_| json!({}))
                } else {
                    match serde_json::from_str(&input) {
                        Ok(value) => Some(value),
                        Err(err) => {
                            self.pending_interaction = Some(interaction);
                            return Err(format!("MCP form content must be JSON: {err}"));
                        }
                    }
                }
            }
            _ => None,
        };
        let response = match &mut interaction.kind {
            InteractionKind::Approval => {
                let Some(decision) = selected_value.clone() else {
                    self.pending_interaction = Some(interaction);
                    return Err("approval has no selected decision".to_string());
                };
                Some(json!({"decision": decision}))
            }
            InteractionKind::McpElicitation { .. } => {
                let Some(action) = selected_value.clone() else {
                    self.pending_interaction = Some(interaction);
                    return Err("MCP request has no selected action".to_string());
                };
                Some(json!({"action": action, "content": mcp_content}))
            }
            InteractionKind::UserInput {
                questions,
                question_index,
                answers,
            } => {
                let Some(question) = questions.get(*question_index) else {
                    self.pending_interaction = Some(interaction);
                    return Err("question index is out of range".to_string());
                };
                let answer = if question.options.is_empty() {
                    if input.is_empty() {
                        self.pending_interaction = Some(interaction);
                        return Err("Type an answer before continuing".to_string());
                    }
                    input
                } else {
                    let Some(answer) = selected_value.clone() else {
                        self.pending_interaction = Some(interaction);
                        return Err("question has no selected answer".to_string());
                    };
                    answer
                };
                answers.insert(
                    question.id.clone(),
                    UserInputAnswer {
                        answers: vec![answer],
                    },
                );
                if *question_index + 1 < questions.len() {
                    *question_index += 1;
                    interaction.load_current_question();
                    self.pending_interaction = Some(interaction);
                    return Ok(None);
                }
                Some(
                    serde_json::to_value(UserInputResponse {
                        answers: answers.clone(),
                    })
                    .map_err(|err| format!("encode answers: {err}"))?,
                )
            }
        };
        let response = response.map(|response| (interaction.request_id, response));
        self.activate_next_interaction("Interaction answered");
        Ok(response)
    }

    fn activate_next_interaction(&mut self, idle_status: &str) {
        self.pending_interaction = self.queued_interactions.pop_front();
        self.status_line = self.pending_interaction.as_ref().map_or_else(
            || idle_status.to_string(),
            |interaction| {
                let queued = self.queued_interactions.len();
                if queued == 0 {
                    format!("Action required: {}", interaction.title)
                } else {
                    format!("Action required: {} ({queued} queued)", interaction.title)
                }
            },
        );
    }
}

fn option(label: &str, description: &str, value: &str) -> InteractionOption {
    InteractionOption {
        label: label.to_string(),
        description: description.to_string(),
        value: value.to_string(),
    }
}

fn decode_params<T: serde::de::DeserializeOwned>(method: &str, value: Value) -> Result<T, String> {
    serde_json::from_value(value).map_err(|err| format!("invalid `{method}` request: {err}"))
}

fn format_value(value: &Value) -> String {
    match value {
        Value::String(value) => value.clone(),
        _ => serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::initialized_default_capabilities;
    use taskforceai_app_protocol::JSONRPC_VERSION;

    fn request(method: &str, params: Value) -> JsonRpcServerRequest {
        JsonRpcServerRequest {
            jsonrpc: JSONRPC_VERSION.to_string(),
            id: json!(7),
            method: method.to_string(),
            params,
        }
    }

    #[test]
    fn approval_requests_open_and_serialize_decisions() {
        let mut state = AppState::new(initialized_default_capabilities(), Vec::new());
        state
            .open_interaction(request(
                "item/commandExecution/requestApproval",
                json!({
                    "threadId": "thread",
                    "turnId": "turn",
                    "itemId": "item",
                    "reason": "Run tests",
                    "command": ["cargo", "test"],
                    "cwd": "/workspace"
                }),
            ))
            .expect("approval request");
        assert!(state.interaction_active());
        state.move_interaction_selection(1);
        let (_, response) = state
            .submit_interaction()
            .expect("submit")
            .expect("response");
        assert_eq!(response["decision"], "acceptForSession");
        assert!(!state.interaction_active());
    }

    #[test]
    fn user_input_collects_each_question() {
        let mut state = AppState::new(initialized_default_capabilities(), Vec::new());
        state
            .open_interaction(request(
                "item/tool/requestUserInput",
                json!({
                    "threadId": "thread",
                    "turnId": "turn",
                    "itemId": "item",
                    "questions": [
                        {
                            "id": "scope",
                            "header": "Scope",
                            "question": "Which scope?",
                            "options": [
                                {"label": "Focused", "description": "Touched files"},
                                {"label": "Full", "description": "Entire repository"}
                            ]
                        },
                        {
                            "id": "note",
                            "header": "Note",
                            "question": "Anything else?",
                            "options": []
                        }
                    ]
                }),
            ))
            .expect("user input request");
        assert!(state.submit_interaction().expect("first answer").is_none());
        for character in "Keep Chat unchanged".chars() {
            state.append_interaction_input(character);
        }
        let (_, response) = state
            .submit_interaction()
            .expect("second answer")
            .expect("response");
        assert_eq!(response["answers"]["scope"]["answers"][0], "Focused");
        assert_eq!(
            response["answers"]["note"]["answers"][0],
            "Keep Chat unchanged"
        );
    }

    #[test]
    fn concurrent_requests_are_queued_without_replacing_the_active_interaction() {
        let mut state = AppState::new(initialized_default_capabilities(), Vec::new());
        let first = request(
            "item/commandExecution/requestApproval",
            json!({"threadId":"a","turnId":"ta","itemId":"ia","reason":"First"}),
        );
        let mut second = request(
            "item/permissions/requestApproval",
            json!({"threadId":"b","turnId":"tb","itemId":"ib","permissions":{"network":true}}),
        );
        second.id = json!(8);
        state.open_interaction(first).expect("first interaction");
        state.open_interaction(second).expect("queued interaction");

        assert_eq!(
            state
                .pending_interaction
                .as_ref()
                .expect("active")
                .request_id,
            json!(7)
        );
        assert_eq!(state.queued_interactions.len(), 1);
        let (request_id, _) = state.cancel_interaction().expect("cancel first");
        assert_eq!(request_id, json!(7));
        assert_eq!(
            state
                .pending_interaction
                .as_ref()
                .expect("promoted")
                .request_id,
            json!(8)
        );
        assert!(state.queued_interactions.is_empty());
    }

    #[test]
    fn mcp_form_keeps_modal_open_for_invalid_json() {
        let mut state = AppState::new(initialized_default_capabilities(), Vec::new());
        state
            .open_interaction(request(
                "mcpServer/elicitation/request",
                json!({
                    "threadId": "mcp",
                    "serverName": "github",
                    "mode": "form",
                    "message": "Provide filters",
                    "requestedSchema": {"type": "object"}
                }),
            ))
            .expect("MCP request");
        state.paste_interaction_input("not-json");
        assert!(state.submit_interaction().is_err());
        assert!(state.interaction_active());
        state.pending_interaction.as_mut().expect("modal").input =
            "{\"state\":\"open\"}".to_string();
        let (_, response) = state
            .submit_interaction()
            .expect("valid JSON")
            .expect("response");
        assert_eq!(response["action"], "accept");
        assert_eq!(response["content"]["state"], "open");
    }

    #[test]
    fn interaction_variants_and_empty_state_edges_are_handled() {
        let mut state = AppState::new(initialized_default_capabilities(), Vec::new());
        assert!(!state.interaction_active());
        state.move_interaction_selection(1);
        state.append_interaction_input('x');
        state.paste_interaction_input("x");
        state.backspace_interaction_input();
        assert!(state.cancel_interaction().is_none());
        assert!(state.submit_interaction().expect("empty submit").is_none());

        assert!(state
            .open_interaction(request("unknown", json!({})))
            .expect_err("unknown request")
            .contains("unsupported"));
        assert!(state
            .open_interaction(request(
                "item/tool/requestUserInput",
                json!({"threadId":"t","turnId":"u","itemId":"i","questions":[]}),
            ))
            .expect_err("empty questions")
            .contains("no questions"));
        assert!(state
            .open_interaction(request("item/fileChange/requestApproval", json!({})))
            .expect_err("invalid parameters")
            .contains("invalid"));

        for (method, params, title) in [
            (
                "item/fileChange/requestApproval",
                json!({
                    "threadId":"t", "turnId":"u", "itemId":"i",
                    "reason":"Edit", "changes":[{"path":"a.rs"}]
                }),
                "File change approval",
            ),
            (
                "item/permissions/requestApproval",
                json!({
                    "threadId":"t", "turnId":"u", "itemId":"i",
                    "reason":"Need access", "permissions":{"network":true}
                }),
                "Permission request",
            ),
        ] {
            state
                .open_interaction(request(method, params))
                .expect("approval variant");
            assert_eq!(
                state.pending_interaction.as_ref().expect("modal").title,
                title
            );
            let (_, response) = state.cancel_interaction().expect("cancel response");
            assert_eq!(response["decision"], "cancel");
        }
        state
            .open_interaction(request(
                "item/commandExecution/requestApproval",
                json!({
                    "threadId":"t", "turnId":"u", "itemId":"i",
                    "reason":"Run", "command":"bun test"
                }),
            ))
            .expect("string command approval");
        state.cancel_interaction();

        state
            .open_interaction(request(
                "mcpServer/elicitation/request",
                json!({
                    "threadId":"mcp", "serverName":"github", "mode":"url",
                    "message":"Authorize", "url":"https://example.test"
                }),
            ))
            .expect("MCP URL request");
        assert!(state
            .pending_interaction
            .as_ref()
            .expect("modal")
            .message
            .contains("https://example.test"));
        state.move_interaction_selection(99);
        state.append_interaction_input('x');
        assert!(state
            .pending_interaction
            .as_ref()
            .expect("modal")
            .input
            .is_empty());
        let (_, response) = state.cancel_interaction().expect("MCP cancel response");
        assert_eq!(response["action"], "cancel");
    }

    #[test]
    fn interaction_text_and_validation_edges_restore_the_modal() {
        let mut state = AppState::new(initialized_default_capabilities(), Vec::new());
        state
            .open_interaction(request(
                "item/tool/requestUserInput",
                json!({
                    "threadId":"t", "turnId":"u", "itemId":"i",
                    "questions":[{"id":"note","header":"Note","question":"Text?","options":[]}]
                }),
            ))
            .expect("text question");
        state.append_interaction_input('\n');
        assert!(state
            .submit_interaction()
            .expect_err("empty answer")
            .contains("Type an answer"));
        state.paste_interaction_input("answer");
        state.backspace_interaction_input();
        state.append_interaction_input('r');
        let (_, response) = state
            .submit_interaction()
            .expect("answer")
            .expect("response");
        assert_eq!(response["answers"]["note"]["answers"][0], "answer");

        state
            .open_interaction(request(
                "mcpServer/elicitation/request",
                json!({
                    "threadId":"mcp", "serverName":"github", "mode":"form",
                    "message":"Provide filters", "requestedSchema":{"type":"object"}
                }),
            ))
            .expect("empty MCP form");
        let (_, response) = state
            .submit_interaction()
            .expect("empty form")
            .expect("response");
        assert_eq!(response["content"], json!({}));

        let mut interaction =
            PendingInteraction::approval(json!(9), "approval".into(), "Title", "Message".into());
        interaction.options.clear();
        interaction.load_current_question();
        state.pending_interaction = Some(interaction);
        state.move_interaction_selection(1);
        assert!(state
            .submit_interaction()
            .expect_err("missing decision")
            .contains("no selected"));

        let mut interaction = PendingInteraction::from_request(request(
            "item/tool/requestUserInput",
            json!({
                "threadId":"t", "turnId":"u", "itemId":"i",
                "questions":[{"id":"choice","header":"Choice","question":"Pick","options":[{"label":"A","description":"A"}]}]
            }),
        ))
        .expect("choice question");
        if let InteractionKind::UserInput { question_index, .. } = &mut interaction.kind {
            *question_index = usize::MAX;
        }
        interaction.load_current_question();
        if let InteractionKind::UserInput { question_index, .. } = &mut interaction.kind {
            *question_index = 0;
        }
        interaction.options.clear();
        state.pending_interaction = Some(interaction);
        assert!(state
            .submit_interaction()
            .expect_err("missing answer")
            .contains("no selected"));

        state.pending_interaction = Some(
            PendingInteraction::from_request(request(
                "item/tool/requestUserInput",
                json!({
                    "threadId":"t", "turnId":"u", "itemId":"i",
                    "questions":[{"id":"choice","header":"Choice","question":"Pick","options":[{"label":"A","description":"A"}]}]
                }),
            ))
            .expect("cancelable question"),
        );
        let (_, response) = state.cancel_interaction().expect("user input cancel");
        assert_eq!(response, json!({"answers": {}}));
    }
}
