use std::collections::HashSet;

use taskforceai_app_protocol::{ClientCapabilities, ClientInfo, InitializeParams};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum InitializationPhase {
    New,
    AwaitingInitialized,
    Ready,
}

#[derive(Debug, Clone)]
pub(crate) struct ConnectionState {
    phase: InitializationPhase,
    client_info: Option<ClientInfo>,
    capabilities: ClientCapabilities,
    notification_opt_outs: HashSet<String>,
}

impl Default for ConnectionState {
    fn default() -> Self {
        Self {
            phase: InitializationPhase::New,
            client_info: None,
            capabilities: ClientCapabilities::default(),
            notification_opt_outs: HashSet::new(),
        }
    }
}

impl ConnectionState {
    pub(crate) fn phase(&self) -> InitializationPhase {
        self.phase
    }

    pub(crate) fn begin_initialize(&mut self, params: &InitializeParams) {
        self.phase = InitializationPhase::AwaitingInitialized;
        self.client_info = params.client_info.clone();
        self.capabilities = params.capabilities.clone();
        self.notification_opt_outs = params
            .capabilities
            .opt_out_notification_methods
            .iter()
            .cloned()
            .collect();
    }

    pub(crate) fn finish_initialize(&mut self) {
        self.phase = InitializationPhase::Ready;
    }

    pub(crate) fn suppresses_notification(&self, method: &str) -> bool {
        self.notification_opt_outs.contains(method)
    }

    pub(crate) fn experimental_api(&self) -> bool {
        self.capabilities.experimental_api
    }
}
