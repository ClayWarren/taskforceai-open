"""TaskForceAI Python SDK."""

from importlib.metadata import version

from .client import AsyncTaskForceAIClient, TaskForceAIClient
from .exceptions import TaskForceAIError
from .files import (
    File,
    FileListResponse,
    FileUploadOptions,
)
from .models import (
    ImageAttachment,
    TaskAwaitingApproval,
    TaskCompleted,
    TaskFailed,
    TaskId,
    TaskProcessing,
    TaskStatusResponse,
    TaskSubmissionRequest,
)
from .streams import (
    AsyncTaskStatusStream,
    TaskStatusStream,
)
from .threads import (
    CreateThreadOptions,
    Thread,
    ThreadListResponse,
    ThreadMessage,
    ThreadMessagesResponse,
    ThreadRunOptions,
    ThreadRunResponse,
)

__version__ = version("taskforceai")

__all__ = [
    "TaskForceAIClient",
    "AsyncTaskForceAIClient",
    "TaskForceAIError",
    "TaskId",
    "TaskStatusResponse",
    "TaskProcessing",
    "TaskCompleted",
    "TaskFailed",
    "TaskAwaitingApproval",
    "TaskSubmissionRequest",
    "ImageAttachment",
    "TaskStatusStream",
    "AsyncTaskStatusStream",
    # Thread types
    "Thread",
    "ThreadMessage",
    "CreateThreadOptions",
    "ThreadListResponse",
    "ThreadMessagesResponse",
    "ThreadRunOptions",
    "ThreadRunResponse",
    # File types
    "File",
    "FileUploadOptions",
    "FileListResponse",
    "__version__",
]
