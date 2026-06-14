use super::*;

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
}
