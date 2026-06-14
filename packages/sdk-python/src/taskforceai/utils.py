from __future__ import annotations

from typing import Any, Dict, Optional

import httpx
from pydantic import TypeAdapter, ValidationError

from .exceptions import TaskForceAIError
from .models import TaskStatusResponse
from .types import TaskSubmissionOptions

TASK_STATUS_ADAPTER: TypeAdapter[TaskStatusResponse] = TypeAdapter(TaskStatusResponse)


def merge_options(
    base_options: Optional[TaskSubmissionOptions],
    *,
    silent: Optional[bool],
    mock: Optional[bool],
) -> Dict[str, Any]:
    options: Dict[str, Any] = {"silent": False, "mock": False}
    if base_options:
        options.update(dict(base_options))
    if silent is not None:
        options["silent"] = silent
    if mock is not None:
        options["mock"] = mock
    return options


def extract_error_message(response: httpx.Response) -> str:
    try:
        data = response.json()
    except ValueError as exc:
        response_text = response.text.strip()
        if not response_text:
            return f"HTTP {response.status_code} response was not valid JSON: {exc}"
        snippet = response_text[:512]
        return f"HTTP {response.status_code} response was not valid JSON: {exc}. Body: {snippet}"

    if isinstance(data, dict):
        error_value = data.get("error")
        if isinstance(error_value, str):
            return error_value
        if error_value is not None:
            return str(error_value)

    return response.text or f"HTTP {response.status_code}"


def validate_task_status(data: Any) -> TaskStatusResponse:
    try:
        validated: TaskStatusResponse = TASK_STATUS_ADAPTER.validate_python(data)
        return validated
    except ValidationError as exc:
        raise TaskForceAIError(f"Invalid API response: {exc}") from exc
