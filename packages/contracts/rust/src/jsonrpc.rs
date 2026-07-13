use std::fmt;

use serde::de::{self, IgnoredAny, MapAccess, Visitor};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub struct JsonRpcRequest {
    pub jsonrpc: Option<String>,
    pub id: Option<Value>,
    pub method: Option<String>,
    pub params: Value,
    id_present: bool,
}

impl JsonRpcRequest {
    pub fn is_notification(&self) -> bool {
        !self.id_present
    }

    pub fn response_id(&self) -> Option<Value> {
        if self.id_present {
            Some(self.id.clone().unwrap_or(Value::Null))
        } else {
            None
        }
    }
}

impl<'de> Deserialize<'de> for JsonRpcRequest {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: de::Deserializer<'de>,
    {
        deserializer.deserialize_map(JsonRpcRequestVisitor)
    }
}

struct JsonRpcRequestVisitor;

impl<'de> Visitor<'de> for JsonRpcRequestVisitor {
    type Value = JsonRpcRequest;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("JSON-RPC request object")
    }

    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        let mut jsonrpc = None;
        let mut jsonrpc_present = false;
        let mut id = None;
        let mut id_present = false;
        let mut method = None;
        let mut method_present = false;
        let mut params = Value::Null;
        let mut params_present = false;

        while let Some(field) = map.next_key()? {
            match field {
                JsonRpcRequestField::Jsonrpc => {
                    reject_duplicate(jsonrpc_present, "jsonrpc")?;
                    jsonrpc_present = true;
                    jsonrpc = map.next_value()?;
                }
                JsonRpcRequestField::Id => {
                    reject_duplicate(id_present, "id")?;
                    id_present = true;
                    let value: Value = map.next_value()?;
                    id = (!value.is_null()).then_some(value);
                }
                JsonRpcRequestField::Method => {
                    reject_duplicate(method_present, "method")?;
                    method_present = true;
                    method = map.next_value()?;
                }
                JsonRpcRequestField::Params => {
                    reject_duplicate(params_present, "params")?;
                    params_present = true;
                    params = map.next_value()?;
                }
                JsonRpcRequestField::Ignore => {
                    map.next_value::<IgnoredAny>()?;
                }
            }
        }

        Ok(JsonRpcRequest {
            jsonrpc,
            id,
            method,
            params,
            id_present,
        })
    }
}

#[derive(Debug)]
enum JsonRpcRequestField {
    Jsonrpc,
    Id,
    Method,
    Params,
    Ignore,
}

impl<'de> Deserialize<'de> for JsonRpcRequestField {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: de::Deserializer<'de>,
    {
        deserializer.deserialize_identifier(JsonRpcRequestFieldVisitor)
    }
}

struct JsonRpcRequestFieldVisitor;

impl Visitor<'_> for JsonRpcRequestFieldVisitor {
    type Value = JsonRpcRequestField;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("JSON-RPC request field")
    }

    fn visit_str<E>(self, field: &str) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        Ok(match field {
            "jsonrpc" => JsonRpcRequestField::Jsonrpc,
            "id" => JsonRpcRequestField::Id,
            "method" => JsonRpcRequestField::Method,
            "params" => JsonRpcRequestField::Params,
            _ => JsonRpcRequestField::Ignore,
        })
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum OutgoingMessage {
    Request(JsonRpcServerRequest),
    Notification(JsonRpcNotification),
    Response(JsonRpcResponse),
}

impl<'de> Deserialize<'de> for OutgoingMessage {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: de::Deserializer<'de>,
    {
        deserializer.deserialize_map(OutgoingMessageVisitor)
    }
}

struct OutgoingMessageVisitor;

impl<'de> Visitor<'de> for OutgoingMessageVisitor {
    type Value = OutgoingMessage;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("JSON-RPC notification or response object")
    }

    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        let mut parts = OutgoingMessageParts::default();
        while let Some(field) = map.next_key()? {
            parts.read_field(field, &mut map)?;
        }
        parts.into_message()
    }
}

#[derive(Default)]
struct OutgoingMessageParts {
    jsonrpc: Option<String>,
    id: Option<Value>,
    id_present: bool,
    method: Option<String>,
    params: Option<Value>,
    result: Option<Value>,
    result_present: bool,
    error: Option<JsonRpcError>,
    error_present: bool,
}

impl OutgoingMessageParts {
    fn read_field<'de, A>(
        &mut self,
        field: OutgoingMessageField,
        map: &mut A,
    ) -> Result<(), A::Error>
    where
        A: MapAccess<'de>,
    {
        match field {
            OutgoingMessageField::Jsonrpc => {
                reject_duplicate(self.jsonrpc.is_some(), "jsonrpc")?;
                self.jsonrpc = Some(map.next_value()?);
            }
            OutgoingMessageField::Id => {
                reject_duplicate(self.id_present, "id")?;
                self.id_present = true;
                let value: Value = map.next_value()?;
                self.id = (!value.is_null()).then_some(value);
            }
            OutgoingMessageField::Method => {
                reject_duplicate(self.method.is_some(), "method")?;
                self.method = Some(map.next_value()?);
            }
            OutgoingMessageField::Params => {
                reject_duplicate(self.params.is_some(), "params")?;
                self.params = Some(map.next_value()?);
            }
            OutgoingMessageField::Result => {
                reject_duplicate(self.result_present, "result")?;
                self.result_present = true;
                self.result = Some(map.next_value()?);
            }
            OutgoingMessageField::Error => {
                reject_duplicate(self.error_present, "error")?;
                self.error_present = true;
                self.error = map.next_value()?;
            }
            OutgoingMessageField::Ignore => {
                map.next_value::<IgnoredAny>()?;
            }
        }
        Ok(())
    }

    fn into_message<E>(self) -> Result<OutgoingMessage, E>
    where
        E: de::Error,
    {
        let has_method = self.method.is_some();
        if has_method && (self.result_present || self.error_present) {
            return Err(E::custom(
                "JSON-RPC request must not mix method with result or error",
            ));
        }

        let jsonrpc = self.jsonrpc.ok_or_else(|| E::missing_field("jsonrpc"))?;
        if let Some(method) = self.method {
            if self.id_present {
                return Ok(OutgoingMessage::Request(JsonRpcServerRequest {
                    jsonrpc,
                    id: self.id.unwrap_or(Value::Null),
                    method,
                    params: self.params.unwrap_or(Value::Null),
                }));
            }
            return Ok(OutgoingMessage::Notification(JsonRpcNotification {
                jsonrpc,
                method,
                params: self.params.unwrap_or(Value::Null),
            }));
        }

        if !self.id_present {
            return Err(E::missing_field("id"));
        }
        Ok(OutgoingMessage::Response(JsonRpcResponse {
            jsonrpc,
            id: self.id,
            result: self.result,
            error: self.error,
        }))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcServerRequest {
    pub jsonrpc: String,
    pub id: Value,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

fn reject_duplicate<E>(present: bool, field: &'static str) -> Result<(), E>
where
    E: de::Error,
{
    if present {
        return Err(E::duplicate_field(field));
    }
    Ok(())
}

#[derive(Debug)]
enum OutgoingMessageField {
    Jsonrpc,
    Id,
    Method,
    Params,
    Result,
    Error,
    Ignore,
}

impl<'de> Deserialize<'de> for OutgoingMessageField {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: de::Deserializer<'de>,
    {
        deserializer.deserialize_identifier(OutgoingMessageFieldVisitor)
    }
}

struct OutgoingMessageFieldVisitor;

impl Visitor<'_> for OutgoingMessageFieldVisitor {
    type Value = OutgoingMessageField;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("JSON-RPC outgoing message field")
    }

    fn visit_str<E>(self, field: &str) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        Ok(match field {
            "jsonrpc" => OutgoingMessageField::Jsonrpc,
            "id" => OutgoingMessageField::Id,
            "method" => OutgoingMessageField::Method,
            "params" => OutgoingMessageField::Params,
            "result" => OutgoingMessageField::Result,
            "error" => OutgoingMessageField::Error,
            _ => OutgoingMessageField::Ignore,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    pub id: Option<Value>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_json_value",
        skip_serializing_if = "Option::is_none"
    )]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

fn deserialize_optional_json_value<'de, D>(deserializer: D) -> Result<Option<Value>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Value::deserialize(deserializer).map(Some)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcNotification {
    pub jsonrpc: String,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcError {
    pub code: i64,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn request_field_rejects_non_string_identifiers() {
        let error = serde_json::from_value::<JsonRpcRequestField>(json!(1))
            .expect_err("numeric request field should not decode");

        assert!(
            error.to_string().contains("JSON-RPC request field"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn outgoing_message_field_rejects_non_string_identifiers() {
        let error = serde_json::from_value::<OutgoingMessageField>(json!(1))
            .expect_err("numeric outgoing message field should not decode");

        assert!(
            error
                .to_string()
                .contains("JSON-RPC outgoing message field"),
            "unexpected error: {error}"
        );
    }
}
