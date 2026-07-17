use taskforceai_app_client::{AppServerClient, AppServerRequestHandle};
use taskforceai_app_protocol::{MetadataGetParams, MetadataSetParams};

use crate::state::{AppState, MAX_PROMPT_HISTORY};

const PROMPT_HISTORY_METADATA_KEY: &str = "tui_prompt_history";

pub(crate) async fn hydrate(client: &AppServerClient, state: &mut AppState) {
    let result = match client
        .metadata_get(MetadataGetParams {
            key: PROMPT_HISTORY_METADATA_KEY.to_string(),
        })
        .await
    {
        Ok(result) => result,
        Err(error) => {
            tracing::warn!(%error, "could not load TUI prompt history");
            return;
        }
    };
    let Some(value) = result.value else {
        return;
    };
    match serde_json::from_str::<Vec<String>>(&value) {
        Ok(history) => state.prompt_history = normalize(history),
        Err(error) => tracing::warn!(%error, "could not parse TUI prompt history"),
    }
}

pub(crate) async fn record_and_persist(
    client: &AppServerClient,
    state: &mut AppState,
    prompt: &str,
) -> bool {
    if !record(state, prompt) {
        return false;
    }
    persist(client, state).await;
    true
}

pub(crate) fn record(state: &mut AppState, prompt: &str) -> bool {
    if state.private_chat_enabled {
        return false;
    }
    state.record_prompt_history(prompt);
    true
}

pub(crate) async fn persist(client: &AppServerClient, state: &AppState) {
    persist_with_handle(client.request_handle(), state.prompt_history.clone()).await;
}

pub(crate) async fn persist_with_handle(
    client: AppServerRequestHandle,
    prompt_history: Vec<String>,
) {
    let value = match serde_json::to_string(&prompt_history) {
        // coverage:ignore-line -- Vec<String> serialization is infallible.
        Ok(value) => value,
        // coverage:ignore-start -- Vec<String> serialization is infallible.
        Err(error) => {
            tracing::warn!(%error, "could not serialize TUI prompt history");
            return;
        } // coverage:ignore-end
    };
    if let Err(error) = client
        .metadata_set(MetadataSetParams {
            key: PROMPT_HISTORY_METADATA_KEY.to_string(),
            value,
        })
        .await
    {
        tracing::warn!(%error, "could not persist TUI prompt history");
    }
}

fn normalize(history: Vec<String>) -> Vec<String> {
    let mut normalized = Vec::with_capacity(history.len().min(MAX_PROMPT_HISTORY));
    for prompt in history {
        let prompt = prompt.trim();
        if !prompt.is_empty() && normalized.last().is_none_or(|last| last != prompt) {
            normalized.push(prompt.to_string());
        }
    }
    if normalized.len() > MAX_PROMPT_HISTORY {
        normalized.drain(..normalized.len() - MAX_PROMPT_HISTORY);
    }
    normalized
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use taskforceai_app_client::AppServerClient;

    use super::*;
    use crate::test_support::{initialized_default_capabilities, start_rpc_sequence_server};

    #[test]
    fn normalizes_loaded_history_to_composer_invariants() {
        let mut history = (0..MAX_PROMPT_HISTORY + 2)
            .map(|index| format!("prompt {index}"))
            .collect::<Vec<_>>();
        history.splice(1..1, [" ".to_string(), "prompt 0".to_string()]);

        let normalized = normalize(history);

        assert_eq!(normalized.len(), MAX_PROMPT_HISTORY);
        assert_eq!(normalized.first().map(String::as_str), Some("prompt 2"));
        assert_eq!(normalized.last().map(String::as_str), Some("prompt 201"));
    }

    #[test]
    fn private_prompts_never_enter_durable_history() {
        let mut state = AppState::new(initialized_default_capabilities(), Vec::new());
        state.private_chat_enabled = true;

        assert!(!record(&mut state, "keep this private"));
        assert!(state.prompt_history.is_empty());
    }

    #[tokio::test]
    async fn history_hydration_and_persistence_cover_rpc_results() {
        let (base_url, server) = start_rpc_sequence_server(vec![
            (
                "metadata.get",
                json!({"value": serde_json::to_string(&vec![" one ", "two"]).unwrap()}),
            ),
            ("metadata.set", json!({"saved": true})),
        ]);
        let client = AppServerClient::connect_http(base_url, "token").expect("client");
        let mut state = AppState::new(initialized_default_capabilities(), Vec::new());
        hydrate(&client, &mut state).await;
        assert_eq!(state.prompt_history, vec!["one", "two"]);
        assert!(record_and_persist(&client, &mut state, "three").await);
        server.join().expect("server");

        let (base_url, server) = start_rpc_sequence_server(vec![
            ("metadata.get", json!({"value": null})),
            ("metadata.get", json!({"value": "not-json"})),
        ]);
        let client = AppServerClient::connect_http(base_url, "token").expect("client");
        hydrate(&client, &mut state).await;
        hydrate(&client, &mut state).await;
        server.join().expect("server");

        let client = AppServerClient::connect_http("http://127.0.0.1:1", "token")
            .expect("client construction");
        hydrate(&client, &mut state).await;
        persist(&client, &state).await;
        state.private_chat_enabled = true;
        assert!(!record_and_persist(&client, &mut state, "private").await);
    }
}
