from taskforceai_core import (
    AVAILABLE_MODEL_IDS,
    DEFAULT_MODEL_ID,
    SENTINEL_MODEL,
    SENTINEL_MODEL_ALIAS,
    SENTINEL_MODEL_ID,
)


def test_sentinel_identity_is_stable() -> None:
    assert SENTINEL_MODEL_ID == "zai/glm-5.2"
    assert SENTINEL_MODEL_ALIAS == "taskforce/sentinel"
    assert SENTINEL_MODEL.model_id == SENTINEL_MODEL_ID
    assert SENTINEL_MODEL.public_label == "Sentinel"
    assert SENTINEL_MODEL.served_alias == SENTINEL_MODEL_ALIAS


def test_default_model_is_available() -> None:
    assert DEFAULT_MODEL_ID == SENTINEL_MODEL_ID
    assert AVAILABLE_MODEL_IDS[0] == DEFAULT_MODEL_ID
    assert "xai/grok-4.5" in AVAILABLE_MODEL_IDS
    assert "meta/muse-spark-1.1" in AVAILABLE_MODEL_IDS
    assert "openai/gpt-5.6-sol" in AVAILABLE_MODEL_IDS
    assert "openai/gpt-5.6-terra" in AVAILABLE_MODEL_IDS
    assert "openai/gpt-5.6-luna" in AVAILABLE_MODEL_IDS
    assert "openai/gpt-5.5" not in AVAILABLE_MODEL_IDS
    assert "anthropic/claude-fable-5" in AVAILABLE_MODEL_IDS
