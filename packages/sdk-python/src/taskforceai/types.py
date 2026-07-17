from __future__ import annotations

from typing import Callable, TypedDict

import httpx

from .models import TaskStatusResponse


class TaskSubmissionOptions(TypedDict, total=False):
    """Options for task submission."""

    model_id: str
    silent: bool
    mock: bool
    attachment_ids: list[str]


ResponseHook = Callable[[httpx.Response], None]
TaskStatusCallback = Callable[[TaskStatusResponse], None]
