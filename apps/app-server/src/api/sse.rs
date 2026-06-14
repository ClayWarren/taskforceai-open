use super::errors::ApiClientError;
use super::models::ApiStreamEvent;

pub(super) fn find_sse_boundary(input: &[u8]) -> Option<(usize, usize)> {
    input
        .windows(2)
        .position(|window| window == b"\n\n")
        .map(|index| (index, 2))
        .or_else(|| {
            input
                .windows(4)
                .position(|window| window == b"\r\n\r\n")
                .map(|index| (index, 4))
        })
}

pub(super) fn parse_sse_frame(frame: &str) -> Result<Option<ApiStreamEvent>, ApiClientError> {
    let payload = frame
        .lines()
        .filter_map(|line| line.strip_prefix("data:"))
        .map(str::trim)
        .collect::<Vec<_>>()
        .join("\n");
    if payload.trim().is_empty() {
        return Ok(None);
    }
    serde_json::from_str(&payload)
        .map(Some)
        .map_err(ApiClientError::Decode)
}
