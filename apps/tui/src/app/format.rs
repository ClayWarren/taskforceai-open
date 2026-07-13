use std::borrow::Cow;

use taskforceai_app_protocol::*;

pub(crate) fn format_generated_media_output(output: &str) -> Cow<'_, str> {
    if let Some(uri) = extract_video_uri(output) {
        return Cow::Owned(format!("Generated video: {uri}"));
    }
    if let Some(uri) = extract_markdown_image_uri(output) {
        if uri.starts_with("data:image/") {
            return Cow::Owned(compact_data_image(&uri));
        }
        return Cow::Owned(format!("Generated image: {uri}"));
    }
    Cow::Borrowed(output)
}

fn extract_video_uri(output: &str) -> Option<String> {
    extract_attr_uri(output, "<source", "src")
        .or_else(|| extract_attr_uri(output, "<video", "src"))
        .or_else(|| extract_markdown_link_uri(output, "generated video"))
}

fn extract_markdown_image_uri(output: &str) -> Option<String> {
    let marker = "](";
    let image_start = output.find("![")?;
    let after_image = &output[image_start..];
    let uri_start = after_image.find(marker)? + marker.len();
    let after_uri_start = &after_image[uri_start..];
    let uri_end = after_uri_start.find(')')?;
    let uri = after_uri_start[..uri_end].trim();
    (!uri.is_empty()).then(|| uri.to_string())
}

fn extract_markdown_link_uri(output: &str, required_label: &str) -> Option<String> {
    let normalized_label = required_label.to_lowercase();
    for line in output.lines() {
        let lower = line.to_lowercase();
        if !lower.contains(&normalized_label) {
            continue;
        }
        let Some(uri_start) = line.find("](").map(|index| index + 2) else {
            continue;
        };
        let after_uri_start = &line[uri_start..];
        let Some(uri_end) = after_uri_start.find(')') else {
            continue;
        };
        let uri = after_uri_start[..uri_end].trim();
        if !uri.is_empty() {
            return Some(uri.to_string());
        }
    }
    None
}

fn extract_attr_uri(output: &str, tag: &str, attr: &str) -> Option<String> {
    let tag_start = output.find(tag)?;
    let after_tag = &output[tag_start..];
    let attr_pattern = format!("{attr}=");
    let attr_start = after_tag.find(&attr_pattern)? + attr_pattern.len();
    let after_attr = &after_tag[attr_start..];
    let mut chars = after_attr.chars();
    let quote = chars.next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }
    let remainder = chars.as_str();
    let uri_end = remainder.find(quote)?;
    let uri = remainder[..uri_end].trim();
    (!uri.is_empty()).then(|| uri.to_string())
}

fn compact_data_image(uri: &str) -> String {
    let media_type = uri
        .strip_prefix("data:")
        .and_then(|rest| rest.split_once(';').map(|(kind, _)| kind))
        .unwrap_or("image");
    let encoded_len = uri
        .split_once(',')
        .map(|(_, encoded)| encoded.len())
        .unwrap_or_default();
    format!("Generated image: inline {media_type} ({encoded_len} base64 chars)")
}

pub(crate) fn format_model_list(result: &ModelListResult) -> String {
    let selected = result
        .selected_model_id
        .as_deref()
        .unwrap_or(&result.default_model_id);
    let mut lines = vec![
        format!("selected: {selected}"),
        format!(
            "catalog: {}",
            if result.remote_catalog {
                "remote"
            } else {
                "local"
            }
        ),
    ];
    for option in &result.options {
        let marker = if selected == option.id { "*" } else { "-" };
        let mut line = format!("{marker} {} [{}]", option.id, option.badge);
        if let Some(description) = &option.description {
            if !description.is_empty() {
                line.push_str(&format!(" - {description}"));
            }
        }
        if let Some(usage_multiple) = option.usage_multiple {
            line.push_str(&format!(" ({}x)", trim_float(usage_multiple)));
        }
        lines.push(line);
    }
    lines.join("\n")
}

pub(crate) fn format_usage_summary(summary: &UsageSummaryResult) -> String {
    let active_runs = summary.queued_runs + summary.processing_runs;
    [
        format!("total runs: {}", summary.total_runs),
        format!("completed: {}", summary.completed_runs),
        format!("failed: {}", summary.failed_runs),
        format!("canceled: {}", summary.canceled_runs),
        format!("active: {active_runs}"),
        format!("queued: {}", summary.queued_runs),
        format!("processing: {}", summary.processing_runs),
    ]
    .join("\n")
}

pub(crate) fn format_ollama_status(result: &OllamaStatusResult) -> String {
    let mut lines = vec![
        format!("connected: {}", result.connected),
        format!("base url: {}", result.base_url),
        format!("memory: {}", result.memory.total_label),
        format!("recommended: {}", result.memory.recommended_model_id),
        format!("reason: {}", result.memory.reason),
    ];
    if let Some(version) = &result.version {
        lines.push(format!("version: {version}"));
    }
    if !result.models.is_empty() {
        lines.push(format!("installed: {}", result.models.join(", ")));
    }
    if let Some(message) = &result.message {
        lines.push(format!("message: {message}"));
    }
    lines.push(format!(
        "Use /model set {} to select it.",
        result.memory.recommended_model_id
    ));
    lines.push(format!(
        "Use /ollama ensure {} to prepare it.",
        result.memory.recommended_model
    ));
    lines.join("\n")
}

pub(crate) fn format_ollama_ensure(result: &OllamaEnsureResult) -> String {
    let mut lines = vec![
        format!("model: {}", result.model),
        format!("pulled: {}", result.pulled),
        format!("connected: {}", result.status.connected),
        format!("memory: {}", result.status.memory.total_label),
        format!("recommended: {}", result.status.memory.recommended_model_id),
    ];
    for event in &result.pull_events {
        match event {
            OllamaPullEventRecord::Status { message } => lines.push(format!("- {message}")),
            OllamaPullEventRecord::Progress {
                digest,
                completed,
                total,
            } => lines.push(format!(
                "- pulling {} {}/{}",
                digest.as_deref().unwrap_or("layer"),
                completed.map_or_else(|| "?".to_string(), |value| value.to_string()),
                total.map_or_else(|| "?".to_string(), |value| value.to_string())
            )),
            OllamaPullEventRecord::Success => lines.push("- ready".to_string()),
            OllamaPullEventRecord::Error { message } => lines.push(format!("- error: {message}")),
        }
    }
    lines.join("\n")
}

pub(crate) fn format_hybrid_mode(result: &HybridModeResult) -> String {
    let mut lines = vec![
        format!("enabled: {}", result.enabled),
        format!("role: {}", result.role),
        format!(
            "local model: {}",
            result.model_id.as_deref().unwrap_or("none")
        ),
        format!("recommended: {}", result.recommended_model_id),
        result.message.clone(),
    ];
    if result.enabled {
        lines.push(format!(
            "Use /ollama ensure {} to prepare the local reviewer.",
            result
                .model_id
                .as_deref()
                .unwrap_or(&result.recommended_model_id)
        ));
    } else {
        lines.push("Use /hybrid on [model] to enable it.".to_string());
    }
    lines.join("\n")
}

pub(crate) fn trim_float(value: f64) -> String {
    let mut rendered = format!("{value:.2}");
    while rendered.contains('.') && rendered.ends_with('0') {
        rendered.pop();
    }
    if rendered.ends_with('.') {
        rendered.pop();
    }
    rendered
}

#[cfg(test)]
mod tests {
    use taskforceai_app_protocol::{
        HybridModeResult, OllamaEnsureResult, OllamaMemoryRecommendation, OllamaPullEventRecord,
        OllamaStatusResult, OrchestrationConfig, UsageSummaryResult,
    };

    use super::{
        format_generated_media_output, format_hybrid_mode, format_ollama_ensure,
        format_ollama_status, format_usage_summary,
    };

    #[test]
    fn generated_media_output_compacts_inline_data_images() {
        assert_eq!(
            format_generated_media_output("![Generated Image](data:image/png;base64,abcdef)"),
            "Generated image: inline image/png (6 base64 chars)"
        );
    }

    #[test]
    fn generated_media_output_compacts_remote_images() {
        assert_eq!(
            format_generated_media_output("![Generated Image](https://example.test/image.png)"),
            "Generated image: https://example.test/image.png"
        );
    }

    #[test]
    fn generated_media_output_compacts_video_html() {
        assert_eq!(
            format_generated_media_output(
                "<video controls><source src=\"https://example.test/generated.mp4\" type=\"video/mp4\"></video>"
            ),
            "Generated video: https://example.test/generated.mp4"
        );
    }

    #[test]
    fn generated_media_output_handles_single_quote_video_and_malformed_links() {
        assert_eq!(
            format_generated_media_output("<video src='https://example.test/generated.mp4'>"),
            "Generated video: https://example.test/generated.mp4"
        );
        assert_eq!(
            format_generated_media_output("![Generated Image]()"),
            "![Generated Image]()"
        );
        assert_eq!(
            format_generated_media_output("[Generated video]()"),
            "[Generated video]()"
        );
        assert_eq!(
            format_generated_media_output("Generated video https://example.test/generated.mp4"),
            "Generated video https://example.test/generated.mp4"
        );
        assert_eq!(
            format_generated_media_output("[Generated video](https://example.test/generated.mp4"),
            "[Generated video](https://example.test/generated.mp4"
        );
        assert_eq!(
            format_generated_media_output("<video src=https://example.test/generated.mp4>"),
            "<video src=https://example.test/generated.mp4>"
        );
    }

    #[test]
    fn generated_media_output_compacts_video_download_link() {
        assert_eq!(
            format_generated_media_output(
                "Done\n\n[Download generated video](https://example.test/generated.mp4)"
            ),
            "Generated video: https://example.test/generated.mp4"
        );
    }

    #[test]
    fn generated_media_output_leaves_plain_text_unchanged() {
        assert_eq!(
            format_generated_media_output("ordinary answer"),
            "ordinary answer"
        );
    }

    fn ollama_status(message: Option<&str>) -> OllamaStatusResult {
        OllamaStatusResult {
            provider_id: "ollama".to_string(),
            base_url: "http://localhost:11434/v1".to_string(),
            host_root: "http://localhost:11434".to_string(),
            connected: false,
            openai_compatible: false,
            responses_supported: None,
            version: None,
            models: Vec::new(),
            default_model: "ollama/gemma4:e4b".to_string(),
            memory: OllamaMemoryRecommendation {
                total_bytes: None,
                total_label: "unknown".to_string(),
                recommended_model_id: "ollama/gemma4:e4b".to_string(),
                recommended_model: "Gemma 4 E4B".to_string(),
                minimum_bytes: 1,
                reason: "No memory signal".to_string(),
            },
            message: message.map(ToOwned::to_owned),
        }
    }

    #[test]
    fn ollama_and_hybrid_formatters_cover_optional_branches() {
        let status = format_ollama_status(&ollama_status(Some("Ollama unavailable")));
        assert!(status.contains("message: Ollama unavailable"));
        assert!(!status.contains("version:"));
        assert!(!status.contains("installed:"));

        let ensure = format_ollama_ensure(&OllamaEnsureResult {
            status: ollama_status(None),
            model: "ollama/gemma4:e4b".to_string(),
            pulled: false,
            pull_events: vec![
                OllamaPullEventRecord::Status {
                    message: "checking".to_string(),
                },
                OllamaPullEventRecord::Progress {
                    digest: None,
                    completed: None,
                    total: None,
                },
                OllamaPullEventRecord::Error {
                    message: "failed".to_string(),
                },
            ],
        });
        assert!(ensure.contains("- checking"));
        assert!(ensure.contains("- pulling layer ?/?"));
        assert!(ensure.contains("- error: failed"));

        let hybrid = format_hybrid_mode(&HybridModeResult {
            enabled: true,
            role: "Reviewer".to_string(),
            model_id: None,
            recommended_model_id: "ollama/gemma4:e4b".to_string(),
            message: "Enabled".to_string(),
            orchestration: OrchestrationConfig {
                roles: Vec::new(),
                budget: None,
            },
        });
        assert!(hybrid.contains("Use /ollama ensure ollama/gemma4:e4b"));
    }

    #[test]
    fn usage_summary_formatter_includes_status_buckets() {
        let rendered = format_usage_summary(&UsageSummaryResult {
            total_runs: 10,
            completed_runs: 6,
            canceled_runs: 1,
            failed_runs: 2,
            queued_runs: 1,
            processing_runs: 0,
        });

        assert!(rendered.contains("total runs: 10"));
        assert!(rendered.contains("completed: 6"));
        assert!(rendered.contains("active: 1"));
        assert!(rendered.contains("queued: 1"));
    }
}
