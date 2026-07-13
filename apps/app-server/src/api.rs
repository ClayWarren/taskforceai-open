mod client;
mod errors;
mod models;
mod sse;
#[cfg(test)]
mod tests;
mod utils;

pub use client::ApiClient;
#[allow(unused_imports)]
pub use errors::ApiClientError;
#[allow(unused_imports)]
pub use models::{
    ApiArtifact, ApiArtifactShare, ApiArtifactVersion, ApiAttachmentUploadResponse,
    ApiCreateProjectRequest, ApiDeviceLoginPoll, ApiDeviceLoginStart, ApiHealth, ApiModelOption,
    ApiModelSelectorResponse, ApiProject, ApiRemoteCommand, ApiRemoteCommandPoll,
    ApiRemoteController, ApiRemoteControllers, ApiRemotePairingCode, ApiRemoteTarget,
    ApiStreamEvent, ApiSubmitMcpServer, ApiSubmitMcpTool, ApiSubmitRunRequest,
    ApiSubmitRunResponse, ApiSyncPullRequest, ApiSyncPullResponse, ApiSyncPushRequest,
    ApiSyncPushResponse, ApiSyncRealtimeMessage, ApiSyncRealtimePollResponse,
};
pub use utils::DEFAULT_API_BASE_URL;

#[cfg(test)]
use utils::{csrf_cookie_from_set_cookie, csrf_url_for_base, normalize_base_url, preview_body};
