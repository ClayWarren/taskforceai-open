use std::hint::black_box;

use criterion::{criterion_group, criterion_main, Criterion};
use serde_json::{json, Value};
use taskforceai_app_protocol::{JsonRpcRequest, JsonRpcResponse, OutgoingMessage, JSONRPC_VERSION};

fn request_payload() -> Vec<u8> {
    serde_json::to_vec(&json!({
        "jsonrpc": JSONRPC_VERSION,
        "id": "request-123",
        "method": "run.submit",
        "params": {
            "prompt": "Summarize the latest project state and queue follow-up work.",
            "modelId": "gpt-5",
            "attachmentIds": ["att_1", "att_2", "att_3"],
            "clientMcpTools": [
                { "server": "filesystem", "name": "read_file" },
                { "server": "github", "name": "create_pull_request" }
            ],
            "metadata": {
                "threadId": "thread_1",
                "turnId": "turn_1",
                "priority": 7
            }
        }
    }))
    .expect("request payload should encode")
}

fn response_payload() -> Vec<u8> {
    serde_json::to_vec(&json!({
        "jsonrpc": JSONRPC_VERSION,
        "id": "request-123",
        "result": {
            "run": {
                "id": "run_123",
                "prompt": "ship it",
                "modelId": "gpt-5",
                "projectId": 42,
                "status": "processing",
                "output": null,
                "error": null,
                "createdAt": 10,
                "updatedAt": 11
            },
            "events": [
                { "type": "run_updated", "runId": "run_123" },
                { "type": "turn_started", "threadId": "thread_1" }
            ]
        }
    }))
    .expect("response payload should encode")
}

fn notification_payload() -> Vec<u8> {
    serde_json::to_vec(&json!({
        "jsonrpc": JSONRPC_VERSION,
        "method": "event",
        "params": {
            "type": "run_updated",
            "run": {
                "id": "run_123",
                "prompt": "ship it",
                "modelId": "gpt-5",
                "projectId": 42,
                "status": "processing",
                "output": null,
                "error": null,
                "createdAt": 10,
                "updatedAt": 11
            }
        }
    }))
    .expect("notification payload should encode")
}

fn bench_jsonrpc(c: &mut Criterion) {
    let request = request_payload();
    c.bench_function("deserialize_request", |b| {
        b.iter(|| {
            serde_json::from_slice::<JsonRpcRequest>(black_box(&request))
                .expect("request should decode")
        })
    });

    let response = response_payload();
    c.bench_function("deserialize_response", |b| {
        b.iter(|| {
            serde_json::from_slice::<JsonRpcResponse>(black_box(&response))
                .expect("response should decode")
        })
    });

    let decoded_response =
        serde_json::from_slice::<JsonRpcResponse>(&response).expect("response should decode");
    c.bench_function("serialize_response", |b| {
        b.iter(|| serde_json::to_vec(black_box(&decoded_response)).expect("response should encode"))
    });

    c.bench_function("deserialize_outgoing_response", |b| {
        b.iter(|| {
            serde_json::from_slice::<OutgoingMessage>(black_box(&response))
                .expect("outgoing response should decode")
        })
    });

    let notification = notification_payload();
    c.bench_function("deserialize_outgoing_notification", |b| {
        b.iter(|| {
            serde_json::from_slice::<OutgoingMessage>(black_box(&notification))
                .expect("outgoing notification should decode")
        })
    });

    let value = serde_json::from_slice::<Value>(&request).expect("value should decode");
    c.bench_function("deserialize_request_from_value", |b| {
        b.iter(|| {
            serde_json::from_value::<JsonRpcRequest>(black_box(value.clone()))
                .expect("request value should decode")
        })
    });
}

criterion_group!(benches, bench_jsonrpc);
criterion_main!(benches);
