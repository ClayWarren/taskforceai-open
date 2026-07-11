use taskforceai_app_protocol::{Capabilities, InitializeResult, ServerInfo, TransportInfo};

pub(crate) fn all_capabilities() -> Capabilities {
    Capabilities {
        auth: true,
        runs: true,
        history: true,
        pending_prompts: true,
        projects: true,
        attachments: true,
        context: true,
        memory: true,
        mcp: true,
        sync: true,
        events: true,
        skills: true,
        plugins: true,
        computer_use: true,
        browser: true,
        agent_sessions: true,
        threads: true,
        turns: true,
        diagnostics: true,
        channels: true,
        schedules: true,
        workflows: true,
        voice: true,
        git_review: true,
    }
}

pub(crate) fn initialized() -> InitializeResult {
    initialized_with_capabilities(all_capabilities())
}

pub(crate) fn initialized_default_capabilities() -> InitializeResult {
    initialized_with_capabilities(Capabilities::default())
}

pub(crate) fn initialized_with_capabilities(capabilities: Capabilities) -> InitializeResult {
    InitializeResult {
        server: ServerInfo::default(),
        transport: TransportInfo {
            kind: "stdio".to_string(),
            encoding: "jsonl".to_string(),
        },
        capabilities,
    }
}
