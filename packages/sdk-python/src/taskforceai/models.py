from __future__ import annotations

from typing import Any, Dict, List, Literal, NewType, Optional, Union

from pydantic import BaseModel, ConfigDict, Field

TaskId = NewType("TaskId", str)


class BaseTaskResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    task_id: TaskId = Field(alias="taskId")
    warnings: List[str] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class TaskProcessing(BaseTaskResponse):
    status: Literal["processing"]
    message: Optional[str] = None


class TaskCompleted(BaseTaskResponse):
    status: Literal["completed"]
    result: Any
    message: Optional[str] = None


class TaskFailed(BaseTaskResponse):
    status: Literal["failed"]
    error: str
    message: Optional[str] = None


class TaskAwaitingApproval(BaseTaskResponse):
    status: Literal["awaiting_approval"]
    error: Optional[str] = None
    message: Optional[str] = None


TaskStatusResponse = Union[TaskProcessing, TaskCompleted, TaskFailed, TaskAwaitingApproval]


class ImageAttachment(BaseModel):
    """An image attachment to include with a task prompt."""

    data: str = Field(description="Base64-encoded image data")
    mime_type: str = Field(description="Image MIME type (e.g. image/jpeg, image/png)")
    name: Optional[str] = Field(default=None, description="Optional filename")


class TaskSubmissionRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    prompt: str
    options: Dict[str, Any] = Field(default_factory=dict)
    model_id: Optional[str] = Field(default=None, alias="modelId")
    attachments: Optional[List[ImageAttachment]] = Field(default=None)
