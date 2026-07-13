from __future__ import annotations

from dataclasses import dataclass
from typing import Final


@dataclass(frozen=True)
class ModelIdentity:
    model_id: str
    public_label: str
    served_alias: str | None = None


SENTINEL_MODEL_ID: Final = "zai/glm-5.2"
SENTINEL_MODEL_ALIAS: Final = "taskforce/sentinel"
SENTINEL_MODEL: Final = ModelIdentity(
    model_id=SENTINEL_MODEL_ID,
    public_label="Sentinel",
    served_alias=SENTINEL_MODEL_ALIAS,
)

DEFAULT_MODEL_ID: Final = SENTINEL_MODEL_ID
AVAILABLE_MODEL_IDS: Final = (
    SENTINEL_MODEL_ID,
    "xai/grok-4.5",
    "meta/muse-spark-1.1",
    "google/gemini-3.1-pro-preview",
    "openai/gpt-5.6-sol",
    "openai/gpt-5.6-terra",
    "openai/gpt-5.6-luna",
    "anthropic/claude-fable-5",
)
