use serde_json::Value;

pub(crate) fn new_mcp_approval<'a>(
    previous: Option<&Value>,
    next: Option<&'a Value>,
) -> Option<&'a Value> {
    let next = next?;
    if !is_mcp_tool_approval(next) {
        return None;
    }
    if previous.is_some_and(|previous| same_mcp_approval(previous, next)) {
        return None;
    }
    Some(next)
}

pub(crate) fn is_mcp_tool_approval(value: &Value) -> bool {
    let metadata = approval_metadata(value);
    metadata
        .and_then(|metadata| metadata.get("source"))
        .and_then(Value::as_str)
        == Some("mcp")
        && metadata
            .and_then(|metadata| metadata.get("action"))
            .and_then(Value::as_str)
            == Some("tool_call")
}

pub(crate) fn same_mcp_approval(previous: &Value, next: &Value) -> bool {
    let previous = approval_metadata(previous);
    let next = approval_metadata(next);
    approval_metadata_string(previous, "serverName") == approval_metadata_string(next, "serverName")
        && approval_metadata_string(previous, "toolName")
            == approval_metadata_string(next, "toolName")
}

pub(crate) fn approval_metadata(value: &Value) -> Option<&serde_json::Map<String, Value>> {
    value
        .get("metadata")
        .and_then(Value::as_object)
        .or_else(|| value.as_object())
}

pub(crate) fn approval_metadata_string(
    metadata: Option<&serde_json::Map<String, Value>>,
    key: &str,
) -> Option<String> {
    metadata?
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}
