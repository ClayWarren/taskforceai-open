use super::*;

#[test]
fn truncated_json_appends_ellipsis_for_large_payloads() {
    let big_value = serde_json::json!({
        "data": "a".repeat(3000)
    });
    let raw = big_value.to_string();
    let output = truncate_json(&big_value);
    assert!(output.ends_with("..."));
    assert!(output.len() < raw.len());
}

#[test]
fn format_tags_filters_empty_values() {
    let tags = Some(vec!["first".into(), "".into(), "second".into()]);
    let formatted = format_tags(&tags);
    assert_eq!(formatted.as_deref(), Some("first,second"));
    assert!(format_tags(&Some(vec![])).is_none());
    assert!(format_tags(&None).is_none());
}

#[test]
fn validated_json_field_rejects_too_deep_payloads() {
    let deep_payload = Some(serde_json::json!({
        "a": {"b": {"c": {"d": {"e": {"f": {"g": {"h": {"i": "value"}}}}}}}}
    }));
    let output = validated_json_field("context", &deep_payload);
    assert!(output.is_some());
    let rendered = output.unwrap_or_default();
    assert!(rendered.contains("invalid_frontend_payload"));
    assert!(rendered.contains("max depth exceeded"));
}

#[test]
fn validated_json_field_truncates_long_strings() {
    let payload = Some(serde_json::json!({
        "message": "a".repeat(MAX_JSON_STRING_LEN + 50)
    }));
    let output = validated_json_field("context", &payload).unwrap_or_default();
    assert!(output.contains("..."));
}

#[test]
fn validated_json_field_handles_all_primitive_values() {
    let payload = Some(serde_json::json!({
        "null": null,
        "bool": true,
        "number": 42,
        "array": [null, false, 7, "ok"],
    }));
    let output = validated_json_field("metadata", &payload).unwrap_or_default();
    assert!(output.contains("\"bool\":true"));
    assert!(output.contains("\"number\":42"));
    assert!(output.contains("\"array\""));
}

#[test]
fn validated_json_field_rejects_large_objects_arrays_and_keys() {
    let too_many_keys = Some(Value::Object(
        (0..=MAX_JSON_OBJECT_KEYS)
            .map(|idx| (format!("key-{idx}"), Value::Bool(true)))
            .collect(),
    ));
    let output = validated_json_field("context", &too_many_keys).unwrap_or_default();
    assert!(output.contains("too many object keys"));

    let too_many_items = Some(Value::Array(vec![Value::Null; MAX_JSON_ARRAY_ITEMS + 1]));
    let output = validated_json_field("context", &too_many_items).unwrap_or_default();
    assert!(output.contains("too many array items"));

    let long_key = Some(Value::Object(Map::from_iter([(
        "k".repeat(MAX_JSON_KEY_LEN + 1),
        Value::Bool(true),
    )])));
    let output = validated_json_field("context", &long_key).unwrap_or_default();
    assert!(output.contains("object key too long"));
}

#[test]
fn sanitize_json_field_enforces_node_budget() {
    let nested_entries = (0..MAX_JSON_OBJECT_KEYS)
        .map(|idx| (format!("child-{idx}"), Value::Null))
        .collect::<Map<_, _>>();
    let payload = Value::Object(
        (0..MAX_JSON_OBJECT_KEYS)
            .map(|idx| (format!("root-{idx}"), Value::Object(nested_entries.clone())))
            .collect(),
    );
    let err = sanitize_json_field(&payload).expect_err("node budget should fail");
    assert!(err.to_string().contains("node budget exceeded"));
}

#[test]
fn format_tags_limits_count_and_tag_length() {
    let tags = Some(
        (0..(MAX_TAGS + 10))
            .map(|idx| format!("tag-{idx}-{}", "x".repeat(MAX_TAG_LEN + 5)))
            .collect::<Vec<_>>(),
    );
    let formatted = format_tags(&tags).unwrap_or_default();
    assert_eq!(formatted.split(',').count(), MAX_TAGS);
    for tag in formatted.split(',') {
        assert!(tag.chars().count() <= MAX_TAG_LEN + 3);
    }
}

#[tokio::test]
async fn log_event_handles_all_levels_without_panicking() {
    let _observability = crate::observability::init();
    let original = std::env::var("RUST_LOG").ok();
    std::env::set_var("RUST_LOG", "debug");

    for level in ["debug", "info", "warn", "error", "unexpected"] {
        let payload = FrontendLogPayload {
            entry: FrontendLogEntry {
                level: level.to_string(),
                message: "hello".into(),
                timestamp: "now".into(),
                context: Some(serde_json::json!({"key": "value"})),
                metadata: Some(serde_json::json!({"meta": true})),
                tags: Some(vec!["alpha".into(), "".into(), "beta".into()]),
            },
        };
        log_event(payload).await;
    }

    match original {
        Some(value) => std::env::set_var("RUST_LOG", value),
        None => std::env::remove_var("RUST_LOG"),
    }
}

#[test]
fn truncate_json_returns_full_string_when_short() {
    let value = serde_json::json!({"short": true});
    assert_eq!(truncate_json(&value), value.to_string());
}

#[test]
fn truncate_json_handles_multibyte_characters() {
    let value = serde_json::json!({"emoji": "😀".repeat(MAX_JSON_LOG_LEN + 20)});
    let output = truncate_json(&value);
    assert!(output.ends_with("..."));
}

#[test]
#[ignore = "release-mode performance benchmark; run with --ignored --nocapture"]
fn validated_json_field_large_payload_benchmark() {
    let payload = Some(large_frontend_log_payload());
    let mut timings = Vec::new();

    for _ in 0..400 {
        let started = std::time::Instant::now();
        let output = validated_json_field("context", &payload).expect("payload renders");
        std::hint::black_box(&output);
        timings.push(started.elapsed());

        assert!(output.ends_with("..."));
        assert!(output.len() < 3_000);
    }

    timings.sort_unstable();
    let median = timings[timings.len() / 2];
    println!(
        "validated_json_field_large_payload median={}us iterations={}",
        median.as_micros(),
        timings.len()
    );
}

fn large_frontend_log_payload() -> Value {
    Value::Object(
        (0..MAX_JSON_OBJECT_KEYS)
            .map(|idx| {
                (
                    format!("field_{idx:02}"),
                    Value::String(format!("{idx}:{}", "x".repeat(MAX_JSON_STRING_LEN * 4))),
                )
            })
            .collect(),
    )
}
