use serde_json::Value;

pub(crate) fn is_new_approval(previous: Option<&Value>, next: Option<&Value>) -> bool {
    match next {
        Some(next) => previous != Some(next),
        None => false,
    }
}

#[cfg(test)]
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

#[cfg(test)]
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

#[cfg(test)]
pub(crate) fn same_mcp_approval(previous: &Value, next: &Value) -> bool {
    let previous_id = approval_identity_string(previous, "approvalId");
    let next_id = approval_identity_string(next, "approvalId");
    if previous_id.is_some() || next_id.is_some() {
        return previous_id.is_some() && previous_id == next_id;
    }

    let previous = approval_metadata(previous);
    let next = approval_metadata(next);
    let (Some(previous_server), Some(next_server)) = (
        approval_metadata_string(previous, "serverName"),
        approval_metadata_string(next, "serverName"),
    ) else {
        return false;
    };
    let (Some(previous_tool), Some(next_tool)) = (
        approval_metadata_string(previous, "toolName"),
        approval_metadata_string(next, "toolName"),
    ) else {
        return false;
    };
    previous_server == next_server
        && previous_tool == next_tool
        && previous.and_then(|metadata| metadata.get("arguments"))
            == next.and_then(|metadata| metadata.get("arguments"))
}

#[cfg(test)]
fn approval_identity_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .or_else(|| approval_metadata(value)?.get(key)?.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

#[cfg(test)]
pub(crate) fn approval_metadata(value: &Value) -> Option<&serde_json::Map<String, Value>> {
    value
        .get("metadata")
        .and_then(Value::as_object)
        .or_else(|| value.as_object())
}

#[cfg(test)]
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn new_approval_requires_a_changed_present_value() {
        let first = json!({"id": 1});
        let second = json!({"id": 2});
        assert!(is_new_approval(None, Some(&first)));
        assert!(!is_new_approval(Some(&first), Some(&first)));
        assert!(is_new_approval(Some(&first), Some(&second)));
        assert!(!is_new_approval(Some(&first), None));
    }
}
