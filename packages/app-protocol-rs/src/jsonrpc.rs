use serde::de;
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
        let raw = Value::deserialize(deserializer)?;
        let object = raw
            .as_object()
            .ok_or_else(|| de::Error::custom("JSON-RPC request must be an object"))?;

        let jsonrpc = optional_string_field(object.get("jsonrpc"))?;
        let method = optional_string_field(object.get("method"))?;
        let id_present = object.contains_key("id");
        let id = object.get("id").filter(|value| !value.is_null()).cloned();
        let params = object.get("params").cloned().unwrap_or(Value::Null);

        Ok(Self {
            jsonrpc,
            id,
            method,
            params,
            id_present,
        })
    }
}

fn optional_string_field<E>(value: Option<&Value>) -> Result<Option<String>, E>
where
    E: de::Error,
{
    match value {
        Some(Value::String(value)) => Ok(Some(value.clone())),
        Some(Value::Null) | None => Ok(None),
        Some(value) => serde_json::from_value(value.clone()).map_err(E::custom),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum OutgoingMessage {
    Notification(JsonRpcNotification),
    Response(JsonRpcResponse),
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
