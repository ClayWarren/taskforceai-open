"""Thread types and models for TaskForceAI SDK."""

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class Thread(BaseModel):
    """Represents a conversation thread."""

    id: int = Field(ge=1)
    title: str
    created_at: datetime
    updated_at: datetime


class ThreadMessage(BaseModel):
    """Represents a message within a thread."""

    id: int = Field(ge=1)
    thread_id: int = Field(ge=1)
    role: Literal["user", "assistant"]
    content: str
    created_at: datetime


class CreateThreadOptions(BaseModel):
    """Options for creating a thread."""

    title: Optional[str] = None
    messages: Optional[List[ThreadMessage]] = None
    metadata: Optional[Dict[str, Any]] = None


class ThreadListResponse(BaseModel):
    """Response containing a list of threads."""

    threads: List[Thread]
    total: int = Field(ge=0)


class ThreadMessagesResponse(BaseModel):
    """Response containing messages from a thread."""

    messages: List[ThreadMessage]
    total: int = Field(ge=0)


class ThreadRunOptions(BaseModel):
    """Options for running a prompt in a thread."""

    prompt: str = Field(min_length=1)
    model_id: Optional[str] = Field(None, alias="modelId")
    options: Optional[Dict[str, Any]] = None


class ThreadRunResponse(BaseModel):
    """Response from running in a thread."""

    task_id: str = Field(min_length=1)
    thread_id: int = Field(ge=1)
    message_id: int = Field(ge=1)
