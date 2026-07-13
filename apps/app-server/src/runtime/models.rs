use crate::ollama::{OllamaStatus, DEFAULT_OLLAMA_MODEL};
use crate::protocol::{
    ModelListResult, ModelOptionRecord, OllamaMemoryRecommendation, OllamaStatusResult,
};
use taskforceai_core::models as core_models;

#[cfg(test)]
pub(crate) const GIB_BYTES: u64 = core_models::GIB_BYTES;
#[cfg(test)]
pub(crate) const OLLAMA_GEMMA4_31B_MIN_BYTES: u64 = core_models::OLLAMA_GEMMA4_31B_MIN_BYTES;
#[cfg(test)]
pub(crate) const OLLAMA_GEMMA4_26B_MIN_BYTES: u64 = core_models::OLLAMA_GEMMA4_26B_MIN_BYTES;
#[cfg(test)]
pub(crate) const OLLAMA_GEMMA4_E4B_MIN_BYTES: u64 = core_models::OLLAMA_GEMMA4_E4B_MIN_BYTES;
#[cfg(test)]
pub(crate) const OLLAMA_GEMMA4_E2B_MIN_BYTES: u64 = core_models::OLLAMA_GEMMA4_E2B_MIN_BYTES;

pub(crate) fn format_model_list(models: &ModelListResult) -> String {
    let mut lines = Vec::with_capacity(models.options.len() + 2);
    lines.push(format!("Default model: {}", models.default_model_id));
    if let Some(selected) = &models.selected_model_id {
        lines.push(format!("Selected model: {selected}"));
    }
    lines.extend(models.options.iter().map(|model| {
        let description = model.description.as_deref().unwrap_or("");
        if description.is_empty() {
            format!("{} [{}] {}", model.id, model.badge, model.label)
        } else {
            format!(
                "{} [{}] {} - {}",
                model.id, model.badge, model.label, description
            )
        }
    }));
    lines.push("Use /model set <id> to switch models.".to_string());
    lines.join("\n")
}

pub(crate) fn local_model_list_result(selected_model_id: Option<String>) -> ModelListResult {
    ModelListResult {
        enabled: true,
        options: default_model_options(),
        default_model_id: core_models::DEFAULT_MODEL_ID.to_string(),
        selected_model_id,
        remote_catalog: false,
    }
}

pub(crate) fn is_ollama_model_id(model_id: &str) -> bool {
    let model_id = model_id.trim();
    model_id == DEFAULT_OLLAMA_MODEL || model_id.starts_with("ollama/")
}

pub(crate) fn ollama_model_name(model_id: Option<&str>) -> String {
    let model_id = model_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_OLLAMA_MODEL);
    model_id
        .strip_prefix("ollama/")
        .unwrap_or(model_id)
        .to_string()
}

pub(crate) fn map_ollama_status(status: OllamaStatus) -> OllamaStatusResult {
    OllamaStatusResult {
        provider_id: status.provider_id,
        base_url: status.base_url,
        host_root: status.host_root,
        connected: status.connected,
        openai_compatible: status.openai_compatible,
        responses_supported: status.responses_supported,
        version: status.version,
        models: status.models,
        default_model: status.default_model,
        memory: ollama_memory_recommendation(total_system_memory_bytes()),
        message: status.message,
    }
}

pub(crate) fn ollama_memory_recommendation(total_bytes: Option<u64>) -> OllamaMemoryRecommendation {
    map_ollama_memory_recommendation(core_models::ollama_memory_recommendation(total_bytes))
}

fn map_ollama_memory_recommendation(
    recommendation: core_models::OllamaMemoryRecommendation,
) -> OllamaMemoryRecommendation {
    OllamaMemoryRecommendation {
        total_bytes: recommendation.total_bytes,
        total_label: recommendation.total_label,
        recommended_model_id: recommendation.recommended_model_id,
        recommended_model: recommendation.recommended_model,
        minimum_bytes: recommendation.minimum_bytes,
        reason: recommendation.reason,
    }
}

#[cfg(test)]
pub(crate) fn format_bytes_gib(bytes: u64) -> String {
    core_models::format_bytes_gib(bytes)
}

#[cfg(target_os = "macos")]
pub(crate) fn total_system_memory_bytes() -> Option<u64> {
    let output = std::process::Command::new("sysctl")
        .args(["-n", "hw.memsize"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None; // coverage:ignore-line
    }
    String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<u64>()
        .ok()
}

#[cfg(target_os = "linux")]
pub(crate) fn total_system_memory_bytes() -> Option<u64> {
    let contents = std::fs::read_to_string("/proc/meminfo").ok()?;
    let kb = contents
        .lines()
        .find_map(|line| line.strip_prefix("MemTotal:"))?
        .split_whitespace()
        .next()?
        .parse::<u64>()
        .ok()?;
    kb.checked_mul(1024)
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub(crate) fn total_system_memory_bytes() -> Option<u64> {
    None
}

pub(crate) fn default_model_options() -> Vec<ModelOptionRecord> {
    core_models::default_model_options()
        .into_iter()
        .map(model_option_record)
        .collect()
}

fn model_option_record(option: core_models::ModelOption) -> ModelOptionRecord {
    let reasoning = core_models::reasoning_effort_config(option.id);
    ModelOptionRecord {
        id: option.id.to_string(),
        label: option.label.to_string(),
        badge: option.badge.to_string(),
        description: option.description.map(str::to_string),
        usage_multiple: option.usage_multiple,
        reasoning_effort_levels: reasoning
            .map(|config| {
                config
                    .levels
                    .iter()
                    .map(|level| (*level).to_string())
                    .collect()
            })
            .unwrap_or_default(),
        default_reasoning_effort: reasoning.map(|config| config.default.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_catalog_formatting_and_ollama_id_helpers_cover_default_shapes() {
        let result = local_model_list_result(Some("ollama/gemma4:e4b".to_string()));
        assert!(result.enabled);
        assert!(!result.remote_catalog);
        assert_eq!(result.default_model_id, "zai/glm-5.2");
        assert_eq!(
            result.selected_model_id.as_deref(),
            Some("ollama/gemma4:e4b")
        );
        assert!(result.options.iter().any(|model| model.label == "Sentinel"));
        assert!(result.options.iter().any(|model| model.badge == "video"));
        for expected_id in [
            "meta/muse-spark-1.1",
            "anthropic/claude-sonnet-5",
            "anthropic/claude-opus-4.8",
            "anthropic/claude-haiku-4.5",
            "google/gemini-3.5-flash",
            "google/gemini-3.1-flash-lite",
        ] {
            assert!(
                result.options.iter().any(|model| model.id == expected_id),
                "expected local model catalog to include {expected_id}"
            );
        }

        let formatted = format_model_list(&ModelListResult {
            options: vec![
                ModelOptionRecord {
                    id: "plain".to_string(),
                    label: "Plain".to_string(),
                    badge: "basic".to_string(),
                    description: None,
                    usage_multiple: None,
                    reasoning_effort_levels: Vec::new(),
                    default_reasoning_effort: None,
                },
                ModelOptionRecord {
                    id: "described".to_string(),
                    label: "Described".to_string(),
                    badge: "pro".to_string(),
                    description: Some("Deep work".to_string()),
                    usage_multiple: Some(2.0),
                    reasoning_effort_levels: Vec::new(),
                    default_reasoning_effort: None,
                },
            ],
            ..result
        });
        assert!(formatted.contains("Default model: zai/glm-5.2"));
        assert!(formatted.contains("Selected model: ollama/gemma4:e4b"));
        assert!(formatted.contains("plain [basic] Plain"));
        assert!(formatted.contains("described [pro] Described - Deep work"));

        assert!(is_ollama_model_id(DEFAULT_OLLAMA_MODEL));
        assert!(is_ollama_model_id(" ollama/gemma4:e2b "));
        assert!(!is_ollama_model_id("zai/glm-5.2"));
        assert_eq!(ollama_model_name(None), DEFAULT_OLLAMA_MODEL);
        assert_eq!(ollama_model_name(Some("  ")), DEFAULT_OLLAMA_MODEL);
        assert_eq!(ollama_model_name(Some("ollama/gemma4:e2b")), "gemma4:e2b");
        assert_eq!(ollama_model_name(Some("llama3")), "llama3");
    }

    #[test]
    fn ollama_status_and_memory_mappers_cover_all_fields() {
        let mapped = map_ollama_status(OllamaStatus {
            provider_id: "ollama".to_string(),
            base_url: "http://127.0.0.1:11434/v1".to_string(),
            host_root: "http://127.0.0.1:11434".to_string(),
            connected: true,
            openai_compatible: true,
            responses_supported: Some(true),
            version: Some("0.12.0".to_string()),
            models: vec!["gemma4:e2b".to_string()],
            default_model: DEFAULT_OLLAMA_MODEL.to_string(),
            message: Some("ready".to_string()),
        });
        assert!(mapped.connected);
        assert_eq!(mapped.provider_id, "ollama");
        assert_eq!(mapped.models, vec!["gemma4:e2b".to_string()]);

        for (bytes, expected_model) in [
            (None, "gemma4:e2b"),
            (Some(4 * GIB_BYTES), "gemma4:e2b"),
            (Some(OLLAMA_GEMMA4_E2B_MIN_BYTES), "gemma4:e2b"),
            (Some(OLLAMA_GEMMA4_E4B_MIN_BYTES), "gemma4:e4b"),
            (Some(OLLAMA_GEMMA4_26B_MIN_BYTES), "gemma4:26b"),
            (Some(OLLAMA_GEMMA4_31B_MIN_BYTES), "gemma4:31b"),
        ] {
            assert_eq!(
                ollama_memory_recommendation(bytes).recommended_model,
                expected_model
            );
        }
        assert_eq!(format_bytes_gib(GIB_BYTES + GIB_BYTES / 2), "1.5 GiB");
    }
}
