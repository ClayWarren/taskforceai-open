#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ModelOption {
    pub id: &'static str,
    pub label: &'static str,
    pub badge: &'static str,
    pub description: Option<&'static str>,
    pub usage_multiple: Option<f64>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct OllamaMemoryRecommendation {
    pub total_bytes: Option<u64>,
    pub total_label: String,
    pub recommended_model_id: String,
    pub recommended_model: String,
    pub minimum_bytes: u64,
    pub reason: String,
}

pub const DEFAULT_MODEL_ID: &str = "zai/glm-5.2";
pub const GIB_BYTES: u64 = 1024 * 1024 * 1024;
pub const OLLAMA_GEMMA4_31B_MIN_BYTES: u64 = 32 * GIB_BYTES;
pub const OLLAMA_GEMMA4_26B_MIN_BYTES: u64 = 24 * GIB_BYTES;
pub const OLLAMA_GEMMA4_E4B_MIN_BYTES: u64 = 16 * GIB_BYTES;
pub const OLLAMA_GEMMA4_E2B_MIN_BYTES: u64 = 8 * GIB_BYTES;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ReasoningEffortConfig {
    pub levels: &'static [&'static str],
    pub default: &'static str,
}

pub fn reasoning_effort_config(model_id: &str) -> Option<ReasoningEffortConfig> {
    let config = match model_id.trim().to_ascii_lowercase().as_str() {
        "openai/gpt-5.6-sol" => ReasoningEffortConfig {
            levels: &["low", "medium", "high", "xhigh", "max"],
            default: "medium",
        },
        "openai/gpt-5.6-terra" | "openai/gpt-5.6-luna" => ReasoningEffortConfig {
            levels: &["low", "medium", "high", "xhigh"],
            default: "medium",
        },
        "xai/grok-4.5" => ReasoningEffortConfig {
            levels: &["low", "medium", "high"],
            default: "high",
        },
        "google/gemini-3.1-pro-preview" => ReasoningEffortConfig {
            levels: &["low", "medium", "high"],
            default: "high",
        },
        "google/gemini-3.5-flash" => ReasoningEffortConfig {
            levels: &["minimal", "low", "medium", "high"],
            default: "medium",
        },
        "google/gemini-3.1-flash-lite" => ReasoningEffortConfig {
            levels: &["minimal", "low", "medium", "high"],
            default: "minimal",
        },
        "anthropic/claude-fable-5" | "anthropic/claude-opus-4.8" => ReasoningEffortConfig {
            levels: &["low", "medium", "high", "xhigh", "max"],
            default: "high",
        },
        "anthropic/claude-sonnet-5" => ReasoningEffortConfig {
            levels: &["low", "medium", "high", "xhigh"],
            default: "high",
        },
        _ => return None,
    };
    Some(config)
}

pub fn default_model_options() -> Vec<ModelOption> {
    vec![
        ModelOption {
            id: DEFAULT_MODEL_ID,
            label: "Sentinel",
            badge: "default",
            description: Some(
                "Our flagship high-reasoning model, optimized for complex task planning.",
            ),
            usage_multiple: Some(1.0),
        },
        ModelOption {
            id: "xai/grok-4.5",
            label: "Grok 4.5",
            badge: "pro",
            description: Some("xAI's latest heavy reasoning tier with extended planning depth."),
            usage_multiple: Some(2.0),
        },
        ModelOption {
            id: "meta/muse-spark-1.1",
            label: "Muse Spark 1.1",
            badge: "pro",
            description: Some(
                "Meta's agentic model for long-running tasks, tool use, and computer use.",
            ),
            usage_multiple: Some(1.0),
        },
        ModelOption {
            id: "google/gemini-3.1-pro-preview",
            label: "Gemini 3.1 Pro",
            badge: "research",
            description: Some("Full-strength Gemini tier geared toward difficult research prompts."),
            usage_multiple: Some(1.0),
        },
        ModelOption {
            id: "google/gemini-3.5-flash",
            label: "Gemini 3.5 Flash",
            badge: "fast",
            description: Some(
                "Fast Gemini tier for everyday prompts, analysis, and tool-heavy workflows.",
            ),
            usage_multiple: Some(1.0),
        },
        ModelOption {
            id: "google/gemini-3.1-flash-lite",
            label: "Gemini 3.1 Flash Lite",
            badge: "fast",
            description: Some("Lightweight Gemini tier optimized for low-latency, lower-cost tasks."),
            usage_multiple: Some(0.5),
        },
        ModelOption {
            id: "google/gemini-2.5-flash-image",
            label: "Gemini Image",
            badge: "image",
            description: Some("Native image generation powered by Gemini 2.5 Flash."),
            usage_multiple: Some(1.0),
        },
        ModelOption {
            id: "xai/grok-imagine-video-1.5",
            label: "Grok Imagine Video",
            badge: "video",
            description: Some(
                "AI Gateway image-to-video generation with synced audio powered by Grok Imagine Video 1.5.",
            ),
            usage_multiple: Some(4.0),
        },
        ModelOption {
            id: "openai/gpt-5.6-sol",
            label: "GPT 5.6 Sol",
            badge: "research",
            description: Some(
                "OpenAI's flagship GPT-5.6 model for the most demanding reasoning tasks.",
            ),
            usage_multiple: Some(3.0),
        },
        ModelOption {
            id: "openai/gpt-5.6-terra",
            label: "GPT 5.6 Terra",
            badge: "pro",
            description: Some(
                "Balanced GPT-5.6 tier for strong everyday reasoning at lower cost.",
            ),
            usage_multiple: Some(2.0),
        },
        ModelOption {
            id: "openai/gpt-5.6-luna",
            label: "GPT 5.6 Luna",
            badge: "fast",
            description: Some(
                "Fast, cost-efficient GPT-5.6 tier for responsive everyday work.",
            ),
            usage_multiple: Some(1.0),
        },
        ModelOption {
            id: "anthropic/claude-fable-5",
            label: "Claude Fable 5",
            badge: "pro",
            description: Some(
                "Anthropic's balance of reasoning strength and latency for fallback coverage.",
            ),
            usage_multiple: Some(2.0),
        },
        ModelOption {
            id: "anthropic/claude-sonnet-5",
            label: "Claude Sonnet 5",
            badge: "pro",
            description: Some(
                "Anthropic Sonnet tier balanced for strong reasoning, coding, and responsiveness.",
            ),
            usage_multiple: Some(2.0),
        },
        ModelOption {
            id: "anthropic/claude-opus-4.8",
            label: "Claude Opus 4.8",
            badge: "research",
            description: Some("Anthropic Opus tier for deeper reasoning and high-stakes synthesis."),
            usage_multiple: Some(3.0),
        },
        ModelOption {
            id: "anthropic/claude-haiku-4.5",
            label: "Claude Haiku 4.5",
            badge: "fast",
            description: Some("Anthropic Haiku tier optimized for fast, lightweight assistant work."),
            usage_multiple: Some(1.0),
        },
        ModelOption {
            id: "ollama/gemma4:e2b",
            label: "Gemma 4 E2B",
            badge: "local",
            description: Some("Local Ollama model for 8GB-class machines."),
            usage_multiple: None,
        },
        ModelOption {
            id: "ollama/gemma4:e4b",
            label: "Gemma 4 E4B",
            badge: "local",
            description: Some("Local Ollama model for 16GB-class machines."),
            usage_multiple: None,
        },
        ModelOption {
            id: "ollama/gemma4:26b",
            label: "Gemma 4 26B",
            badge: "local",
            description: Some("Local Ollama model for 24GB-class machines."),
            usage_multiple: None,
        },
        ModelOption {
            id: "ollama/gemma4:31b",
            label: "Gemma 4 31B",
            badge: "local",
            description: Some("Local Ollama model for 32GB+ machines."),
            usage_multiple: None,
        },
    ]
}

pub fn ollama_memory_recommendation(total_bytes: Option<u64>) -> OllamaMemoryRecommendation {
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

pub fn format_bytes_gib(bytes: u64) -> String {
    format!("{:.1} GiB", bytes as f64 / GIB_BYTES as f64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_model_catalog_contains_supported_product_options() {
        let options = default_model_options();
        assert_eq!(
            options.first().map(|option| option.id),
            Some(DEFAULT_MODEL_ID)
        );
        assert!(options.iter().any(|option| option.label == "Sentinel"));

        let video = options
            .iter()
            .find(|option| option.id == "xai/grok-imagine-video-1.5")
            .expect("video model should be in the default catalog");
        assert_eq!(video.badge, "video");
        assert!(video
            .description
            .unwrap_or_default()
            .contains("image-to-video"));

        for expected_id in [
            "meta/muse-spark-1.1",
            "openai/gpt-5.6-sol",
            "openai/gpt-5.6-terra",
            "openai/gpt-5.6-luna",
            "anthropic/claude-sonnet-5",
            "anthropic/claude-opus-4.8",
            "anthropic/claude-haiku-4.5",
            "google/gemini-3.5-flash",
            "google/gemini-3.1-flash-lite",
            "ollama/gemma4:e2b",
        ] {
            assert!(
                options.iter().any(|option| option.id == expected_id),
                "expected local model catalog to include {expected_id}"
            );
        }
        assert!(!options.iter().any(|option| option.id == "openai/gpt-5.5"));
    }

    #[test]
    fn reasoning_effort_config_matches_supported_model_capabilities() {
        for (model_id, expected_default, expected_levels) in [
            (
                " openai/gpt-5.6-sol ",
                "medium",
                &["low", "medium", "high", "xhigh", "max"][..],
            ),
            (
                "openai/gpt-5.6-terra",
                "medium",
                &["low", "medium", "high", "xhigh"][..],
            ),
            (
                "openai/gpt-5.6-luna",
                "medium",
                &["low", "medium", "high", "xhigh"][..],
            ),
            ("xai/grok-4.5", "high", &["low", "medium", "high"][..]),
            (
                "google/gemini-3.1-pro-preview",
                "high",
                &["low", "medium", "high"][..],
            ),
            (
                "google/gemini-3.5-flash",
                "medium",
                &["minimal", "low", "medium", "high"][..],
            ),
            (
                "google/gemini-3.1-flash-lite",
                "minimal",
                &["minimal", "low", "medium", "high"][..],
            ),
            (
                "anthropic/claude-fable-5",
                "high",
                &["low", "medium", "high", "xhigh", "max"][..],
            ),
            (
                "anthropic/claude-opus-4.8",
                "high",
                &["low", "medium", "high", "xhigh", "max"][..],
            ),
            (
                "anthropic/claude-sonnet-5",
                "high",
                &["low", "medium", "high", "xhigh"][..],
            ),
        ] {
            let config = reasoning_effort_config(model_id)
                .unwrap_or_else(|| panic!("expected reasoning config for {model_id}"));
            assert_eq!(config.default, expected_default);
            assert_eq!(config.levels, expected_levels);
        }

        assert_eq!(reasoning_effort_config("openai/gpt-4"), None);
    }

    #[test]
    fn ollama_memory_recommendation_scales_with_detected_memory() {
        let unknown = ollama_memory_recommendation(None);
        assert_eq!(unknown.recommended_model_id, "ollama/gemma4:e2b");
        assert_eq!(unknown.minimum_bytes, OLLAMA_GEMMA4_E2B_MIN_BYTES);

        let eight_gb = ollama_memory_recommendation(Some(OLLAMA_GEMMA4_E2B_MIN_BYTES));
        assert_eq!(eight_gb.recommended_model_id, "ollama/gemma4:e2b");

        let sixteen_gb = ollama_memory_recommendation(Some(OLLAMA_GEMMA4_E4B_MIN_BYTES));
        assert_eq!(sixteen_gb.recommended_model_id, "ollama/gemma4:e4b");

        let twenty_four_gb = ollama_memory_recommendation(Some(OLLAMA_GEMMA4_26B_MIN_BYTES));
        assert_eq!(twenty_four_gb.recommended_model_id, "ollama/gemma4:26b");

        let thirty_two_gb = ollama_memory_recommendation(Some(OLLAMA_GEMMA4_31B_MIN_BYTES));
        assert_eq!(thirty_two_gb.recommended_model, "gemma4:31b");
        assert_eq!(format_bytes_gib(GIB_BYTES + GIB_BYTES / 2), "1.5 GiB");
    }
}
