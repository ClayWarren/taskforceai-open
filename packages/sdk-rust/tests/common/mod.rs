use taskforceai_sdk::{TaskForceAI, TaskForceAIOptions};

pub const TEST_API_KEY: &str = "key";

pub fn client_with_key(base_url: String) -> TaskForceAI {
    TaskForceAI::new(TaskForceAIOptions {
        base_url: Some(base_url),
        api_key: Some(TEST_API_KEY.to_string()),
        ..Default::default()
    })
    .expect("expected client creation to succeed")
}
