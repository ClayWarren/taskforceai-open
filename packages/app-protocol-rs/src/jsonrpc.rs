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
        let mut id = None;
        let mut id_present = false;
        let mut method = None;
        let mut params = Value::Null;

        while let Some(field) = map.next_key()? {
            match field {
                JsonRpcRequestField::Jsonrpc => {
                    jsonrpc = map.next_value()?;
                }
                JsonRpcRequestField::Id => {
                    id_present = true;
                    let value: Value = map.next_value()?;
                    id = (!value.is_null()).then_some(value);
                }
                JsonRpcRequestField::Method => {
                    method = map.next_value()?;
                }
                JsonRpcRequestField::Params => {
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
    Notification(JsonRpcNotification),
    Response(JsonRpcResponse),
}

impl<'de> Deserialize<'de> for OutgoingMessage {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: de::Deserializer<'de>,
    {
        let raw = Value::deserialize(deserializer)?;
        if raw.get("method").is_some() {
            serde_json::from_value(raw)
                .map(OutgoingMessage::Notification)
                .map_err(de::Error::custom)
        } else {
            serde_json::from_value(raw)
                .map(OutgoingMessage::Response)
                .map_err(de::Error::custom)
        }
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
}
