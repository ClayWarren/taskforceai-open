use crate::ollama::{OllamaPullEvent, OllamaStatus, DEFAULT_OLLAMA_MODEL};
use crate::protocol::{
    ModelListResult, ModelOptionRecord, OllamaMemoryRecommendation, OllamaPullEventRecord,
    OllamaStatusResult,
};

pub(crate) const GIB_BYTES: u64 = 1024 * 1024 * 1024;
pub(crate) const OLLAMA_GEMMA4_31B_MIN_BYTES: u64 = 32 * GIB_BYTES;
pub(crate) const OLLAMA_GEMMA4_26B_MIN_BYTES: u64 = 24 * GIB_BYTES;
pub(crate) const OLLAMA_GEMMA4_E4B_MIN_BYTES: u64 = 16 * GIB_BYTES;
pub(crate) const OLLAMA_GEMMA4_E2B_MIN_BYTES: u64 = 8 * GIB_BYTES;

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
        default_model_id: "moonshotai/kimi-k2.6".to_string(),
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
    let Some(bytes) = total_bytes else {
        return OllamaMemoryRecommendation {
            total_bytes: None,
            total_label: "unknown".to_string(),
            recommended_model_id: "ollama/gemma4:e2b".to_string(),
            recommended_model: "gemma4:e2b".to_string(),
            minimum_bytes: OLLAMA_GEMMA4_E2B_MIN_BYTES,
            reason: "Could not detect system memory; start with Gemma 4 E2B.".to_string(),
        };
    };

    if bytes >= OLLAMA_GEMMA4_31B_MIN_BYTES {
        return OllamaMemoryRecommendation {
            total_bytes: Some(bytes),
            total_label: format_bytes_gib(bytes),
            recommended_model_id: "ollama/gemma4:31b".to_string(),
            recommended_model: "gemma4:31b".to_string(),
            minimum_bytes: OLLAMA_GEMMA4_31B_MIN_BYTES,
            reason: "Detected enough memory for Gemma 4 31B.".to_string(),
        };
    }

    if bytes >= OLLAMA_GEMMA4_26B_MIN_BYTES {
        return OllamaMemoryRecommendation {
            total_bytes: Some(bytes),
            total_label: format_bytes_gib(bytes),
            recommended_model_id: "ollama/gemma4:26b".to_string(),
            recommended_model: "gemma4:26b".to_string(),
            minimum_bytes: OLLAMA_GEMMA4_26B_MIN_BYTES,
            reason: "Detected enough memory for Gemma 4 26B with more headroom than 31B."
                .to_string(),
        };
    }

    if bytes >= OLLAMA_GEMMA4_E4B_MIN_BYTES {
        return OllamaMemoryRecommendation {
            total_bytes: Some(bytes),
            total_label: format_bytes_gib(bytes),
            recommended_model_id: "ollama/gemma4:e4b".to_string(),
            recommended_model: "gemma4:e4b".to_string(),
            minimum_bytes: OLLAMA_GEMMA4_E4B_MIN_BYTES,
            reason: "Detected enough memory for Gemma 4 E4B with more headroom than larger local models."
                .to_string(),
        };
    };

    if bytes >= OLLAMA_GEMMA4_E2B_MIN_BYTES {
        return OllamaMemoryRecommendation {
            total_bytes: Some(bytes),
            total_label: format_bytes_gib(bytes),
            recommended_model_id: "ollama/gemma4:e2b".to_string(),
            recommended_model: "gemma4:e2b".to_string(),
            minimum_bytes: OLLAMA_GEMMA4_E2B_MIN_BYTES,
            reason: "Detected enough memory for Gemma 4 E2B on an 8GB-class machine.".to_string(),
        };
    }

    OllamaMemoryRecommendation {
        total_bytes: Some(bytes),
        total_label: format_bytes_gib(bytes),
        recommended_model_id: "ollama/gemma4:e2b".to_string(),
        recommended_model: "gemma4:e2b".to_string(),
        minimum_bytes: OLLAMA_GEMMA4_E2B_MIN_BYTES,
        reason: "Detected less than 8 GiB of memory; Gemma 4 E2B is the smallest supported recommendation.".to_string(),
    }
}

pub(crate) fn format_bytes_gib(bytes: u64) -> String {
    format!("{:.1} GiB", bytes as f64 / GIB_BYTES as f64)
}

#[cfg(target_os = "macos")]
pub(crate) fn total_system_memory_bytes() -> Option<u64> {
    let output = std::process::Command::new("sysctl")
        .args(["-n", "hw.memsize"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
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

pub(crate) fn map_ollama_pull_event(event: OllamaPullEvent) -> OllamaPullEventRecord {
    match event {
        OllamaPullEvent::Status { message } => OllamaPullEventRecord::Status { message },
        OllamaPullEvent::Progress {
            digest,
            completed,
            total,
        } => OllamaPullEventRecord::Progress {
            digest,
            completed,
            total,
        },
        OllamaPullEvent::Success => OllamaPullEventRecord::Success,
        OllamaPullEvent::Error { message } => OllamaPullEventRecord::Error { message },
    }
}

pub(crate) fn default_model_options() -> Vec<ModelOptionRecord> {
    vec![
        ModelOptionRecord {
            id: "moonshotai/kimi-k2.6".to_string(),
            label: "Sentinel".to_string(),
            badge: "default".to_string(),
            description: Some(
                "Our flagship high-reasoning model, optimized for complex task planning."
                    .to_string(),
            ),
            usage_multiple: Some(1.0),
        },
        ModelOptionRecord {
            id: "xai/grok-4.3".to_string(),
            label: "Grok 4.3".to_string(),
            badge: "pro".to_string(),
            description: Some(
                "xAI's latest heavy reasoning tier with extended planning depth.".to_string(),
            ),
            usage_multiple: Some(2.0),
        },
        ModelOptionRecord {
            id: "google/gemini-3.1-pro-preview".to_string(),
            label: "Gemini 3.1 Pro".to_string(),
            badge: "research".to_string(),
            description: Some(
                "Full-strength Gemini tier geared toward difficult research prompts.".to_string(),
            ),
            usage_multiple: Some(1.0),
        },
        ModelOptionRecord {
            id: "google/gemini-2.5-flash-image".to_string(),
            label: "Gemini Image".to_string(),
            badge: "image".to_string(),
            description: Some("Native image generation powered by Gemini 2.5 Flash.".to_string()),
            usage_multiple: Some(1.0),
        },
        ModelOptionRecord {
            id: "xai/grok-imagine-video".to_string(),
            label: "Grok Imagine Video".to_string(),
            badge: "video".to_string(),
            description: Some(
                "AI Gateway video generation for text-to-video, image-to-video, and video editing."
                    .to_string(),
            ),
            usage_multiple: Some(4.0),
        },
        ModelOptionRecord {
            id: "openai/gpt-5.5".to_string(),
            label: "GPT 5.5".to_string(),
            badge: "pro".to_string(),
            description: Some(
                "OpenAI GPT-5.5 profile tuned for extended reasoning depth.".to_string(),
            ),
            usage_multiple: Some(1.0),
        },
        ModelOptionRecord {
            id: "anthropic/claude-fable-5".to_string(),
            label: "Claude Fable 5".to_string(),
            badge: "pro".to_string(),
            description: Some(
                "Anthropic's balance of reasoning strength and latency for fallback coverage."
                    .to_string(),
            ),
            usage_multiple: Some(2.0),
        },
        ModelOptionRecord {
            id: "ollama/gemma4:e2b".to_string(),
            label: "Gemma 4 E2B".to_string(),
            badge: "local".to_string(),
            description: Some("Local Ollama model for 8GB-class machines.".to_string()),
            usage_multiple: None,
        },
        ModelOptionRecord {
            id: "ollama/gemma4:e4b".to_string(),
            label: "Gemma 4 E4B".to_string(),
            badge: "local".to_string(),
            description: Some("Local Ollama model for 16GB-class machines.".to_string()),
            usage_multiple: None,
        },
        ModelOptionRecord {
            id: "ollama/gemma4:26b".to_string(),
            label: "Gemma 4 26B".to_string(),
            badge: "local".to_string(),
            description: Some("Local Ollama model for 24GB-class machines.".to_string()),
            usage_multiple: None,
        },
        ModelOptionRecord {
            id: "ollama/gemma4:31b".to_string(),
            label: "Gemma 4 31B".to_string(),
            badge: "local".to_string(),
            description: Some("Local Ollama model for 32GB+ machines.".to_string()),
            usage_multiple: None,
        },
    ]
}
