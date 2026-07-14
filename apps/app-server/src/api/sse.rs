use super::errors::ApiClientError;
use super::models::ApiStreamEvent;

pub(super) fn find_sse_boundary(input: &[u8]) -> Option<(usize, usize)> {
    let mut index = 0;
    while index + 1 < input.len() {
        if input[index] == b'\n' && input[index + 1] == b'\n' {
            return Some((index, 2));
        }
        if index + 3 < input.len()
            && input[index] == b'\r'
            && input[index + 1] == b'\n'
            && input[index + 2] == b'\r'
            && input[index + 3] == b'\n'
        {
            return Some((index, 4));
        }
        index += 1;
    }
    None
}

pub(super) fn parse_sse_frame(frame: &str) -> Result<Option<ApiStreamEvent>, ApiClientError> {
    let mut first_payload_line: Option<&str> = None;
    let mut joined_payload: Option<String> = None;
    for line in frame.lines().filter_map(|line| line.strip_prefix("data:")) {
        let line = line.trim();
        if let Some(joined) = joined_payload.as_mut() {
            joined.push('\n');
            joined.push_str(line);
        } else if let Some(first) = first_payload_line {
            let mut joined = String::with_capacity(first.len() + 1 + line.len());
            joined.push_str(first);
            joined.push('\n');
            joined.push_str(line);
            joined_payload = Some(joined);
        } else {
            first_payload_line = Some(line);
        }
    }
    let payload = joined_payload
        .as_deref()
        .or(first_payload_line)
        .unwrap_or_default();
    if payload.trim().is_empty() {
        return Ok(None);
    }
    serde_json::from_str(payload)
        .map(Some)
        .map_err(ApiClientError::Decode)
}

#[cfg(test)]
mod tests {
    use std::{
        hint::black_box,
        time::{Duration, Instant},
    };

    use super::{find_sse_boundary, parse_sse_frame};

    #[test]
    fn find_sse_boundary_detects_lf_and_crlf_frames() {
        assert_eq!(find_sse_boundary(b"data: one\n\nnext"), Some((9, 2)));
        assert_eq!(find_sse_boundary(b"data: one\r\n\r\nnext"), Some((9, 4)));
        assert_eq!(find_sse_boundary(b"data: partial\n"), None);
    }

    #[test]
    fn parse_sse_frame_joins_multiple_data_lines_and_skips_empty_payloads() {
        let event = parse_sse_frame(
            "event: update\ndata: {\"type\":\"progress\",\ndata: \"chunk\":\"hello\"}",
        )
        .expect("joined payload should parse")
        .expect("event should be present");
        assert_eq!(event.event_type, "progress");
        assert_eq!(event.chunk, "hello");

        let event = parse_sse_frame(
            "data: {\"type\":\"progress\",\ndata: \"chunk\":\"hello\",\ndata: \"message\":\"world\"}",
        )
        .expect("three-line payload should parse")
        .expect("event should be present");
        assert_eq!(event.message, "world");

        assert!(parse_sse_frame("event: heartbeat\ndata:   ")
            .expect("empty payload should not error")
            .is_none());
        assert!(parse_sse_frame(": keepalive")
            .expect("missing data payload should not error")
            .is_none());

        let missing_approval = parse_sse_frame("data: {\"type\":\"progress\"}")
            .expect("missing approval should parse")
            .expect("event should be present");
        assert_eq!(missing_approval.pending_approval, None);
        let cleared_approval =
            parse_sse_frame("data: {\"type\":\"progress\",\"pendingApproval\":null}")
                .expect("null approval should parse")
                .expect("event should be present");
        assert_eq!(
            cleared_approval.pending_approval,
            Some(serde_json::Value::Null)
        );
    }

    #[test]
    #[ignore = "prints focused SSE boundary performance timing"]
    fn bench_sse_crlf_boundary_scan() {
        let frame = format!("data: {}\r\n\r\n", "x".repeat(8 * 1024));
        const ITERATIONS: u32 = 200_000;

        let elapsed = time_iterations(ITERATIONS, || {
            black_box(find_sse_boundary(black_box(frame.as_bytes())));
        });

        let ns_per_scan = elapsed.as_nanos() as f64 / f64::from(ITERATIONS);
        println!(
            "bench_sse_crlf_boundary_scan: {ITERATIONS} scans in {:?} ({ns_per_scan:.2} ns/scan)",
            elapsed
        );
    }

    #[test]
    #[ignore = "prints focused SSE frame parser performance timing"]
    fn bench_sse_frame_parse() {
        let frame = format!(
            ": heartbeat\nevent: progress\ndata: {{\"type\":\"progress\",\"chunk\":\"{}\",\"message\":\"\",\"error\":\"\"}}\n",
            "x".repeat(512)
        );
        const ITERATIONS: u32 = 100_000;

        let elapsed = time_iterations(ITERATIONS, || {
            black_box(parse_sse_frame(black_box(&frame)).expect("frame should parse"));
        });

        let ns_per_frame = elapsed.as_nanos() as f64 / f64::from(ITERATIONS);
        println!(
            "bench_sse_frame_parse: {ITERATIONS} frames in {:?} ({ns_per_frame:.2} ns/frame)",
            elapsed
        );
    }

    fn time_iterations(iterations: u32, mut run: impl FnMut()) -> Duration {
        let start = Instant::now();
        for _ in 0..iterations {
            run();
        }
        start.elapsed()
    }
}
