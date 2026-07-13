"""Thread types and models for TaskForceAI SDK."""

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class Thread(BaseModel):
    """Represents a conversation thread."""

    id: int = Field(ge=1)
    timestamp: str
    user_input: str
    result: str
    execution_time: int = Field(ge=0)
    model: str
    agent_count: int = Field(ge=0)
    sources: Optional[List[Dict[str, Any]]]
    agent_statuses: Optional[List[Dict[str, Any]]] = Field(alias="agentStatuses")
    tool_events: Optional[List[Dict[str, Any]]] = Field(alias="toolEvents")

    @property
    def title(self) -> str:
        """Backward-compatible alias for the conversation's user input."""
        return self.user_input


class ThreadMessage(BaseModel):
    """Represents a message within a thread."""

    id: int = Field(ge=1)
    thread_id: int = Field(ge=1)
    role: Literal["user", "assistant"]
    content: str
    message_id: Optional[str] = None
    is_agent_status: bool = False
    elapsed_seconds: Optional[float] = None
    created_at: Optional[datetime] = None
    error: Optional[str] = None
    sources: Optional[Any] = None
    tool_events: Optional[Any] = None
    agent_statuses: Optional[Any] = None
    updated_at: Optional[datetime] = None
    rating: int = 0


class CreateThreadOptions(BaseModel):
    """Options for creating a thread."""

    title: Optional[str] = None
    messages: Optional[List[ThreadMessage]] = None
    metadata: Optional[Dict[str, Any]] = None


class ThreadListResponse(BaseModel):
    """Response containing a list of threads."""

    conversations: List[Thread]
    total: int = Field(ge=0)
    limit: int = Field(ge=0)
    offset: int = Field(ge=0)
    has_more: bool

    @property
    def threads(self) -> List[Thread]:
        """Backward-compatible alias for conversations."""
        return self.conversations


class ThreadMessagesResponse(BaseModel):
    """Response containing messages from a thread."""

    messages: List[ThreadMessage]
    truncated: bool = False


class ThreadRunOptions(BaseModel):
    """Options for running a prompt in a thread."""

    model_config = ConfigDict(populate_by_name=True)

    prompt: str = Field(min_length=1)
    model_id: Optional[str] = Field(None, alias="modelId")
    stream: Optional[bool] = None
    options: Optional[Dict[str, Any]] = None


class ThreadRunResponse(BaseModel):
    """Response from running in a thread."""

    model_config = ConfigDict(populate_by_name=True)

    task_id: str = Field(alias="taskId", min_length=1)
    status: str = Field(min_length=1)
