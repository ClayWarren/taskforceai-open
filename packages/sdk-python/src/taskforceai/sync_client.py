from __future__ import annotations

import time
import uuid
import weakref
from datetime import datetime, timezone
from types import TracebackType
from typing import Any, BinaryIO, Dict, Optional, Union
from urllib.parse import quote

import httpx

from .exceptions import TaskForceAIError
from .files import File, FileListResponse, FileUploadOptions
from .models import ImageAttachment, TaskId, TaskSubmissionRequest
from .streams import TaskStatusStream
from .threads import (
    CreateThreadOptions,
    Thread,
    ThreadListResponse,
    ThreadMessagesResponse,
    ThreadRunOptions,
    ThreadRunResponse,
)
from .types import ResponseHook, TaskStatusCallback, TaskSubmissionOptions
from .utils import extract_error_message, merge_options, validate_task_status

DEFAULT_BASE_URL = "https://taskforceai.chat/api/v1/developer"

MOCK_RESULT = "This is a mock response. Configure your API key to get real results."


def _headers(api_key: str) -> Dict[str, str]:
    return {
        "Content-Type": "application/json",
        "x-api-key": api_key,
        "X-SDK-Language": "python",
    }


def _path_segment(value: object) -> str:
    return quote(str(value), safe="")


def _coerce_non_negative_int(value: object, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise TaskForceAIError(f"{name} must be an integer")
    if value < 0:
        raise TaskForceAIError(f"{name} must be non-negative")
    return value


def _coerce_positive_int(value: object, name: str) -> int:
    coerced = _coerce_non_negative_int(value, name)
    if coerced == 0:
        raise TaskForceAIError(f"{name} must be greater than zero")
    return coerced


def _thread_path_segment(thread_id: object) -> str:
    return str(_coerce_positive_int(thread_id, "Thread ID"))


def _pagination_query(limit: object, offset: object) -> str:
    safe_limit = _coerce_positive_int(limit, "Limit")
    safe_offset = _coerce_non_negative_int(offset, "Offset")
    return f"limit={safe_limit}&offset={safe_offset}"


def _mock_status_response(base_endpoint: str, call_count: Dict[str, int]) -> Dict[str, Any]:
    task_id = base_endpoint.split("/")[-1]
    count = call_count.get(task_id, 0)
    call_count[task_id] = count + 1
    if count < 1:
        return {
            "taskId": task_id,
            "status": "processing",
            "message": "Mock task processing...",
        }
    return {"taskId": task_id, "status": "completed", "result": MOCK_RESULT}


def _mock_thread_response(method: str, base_endpoint: str) -> Dict[str, Any]:
    if method == "GET" and "/messages" in base_endpoint:
        return {"messages": [], "total": 0}
    if method == "GET" and base_endpoint == "/threads":
        return {"threads": [], "total": 0}
    return {"id": 1, "title": "Mock", "created_at": time.time(), "updated_at": time.time()}


def _mock_file_response(method: str, base_endpoint: str) -> Any:
    if method == "GET" and base_endpoint == "/files":
        return {"files": [], "total": 0}
    if method == "GET" and "/content" in base_endpoint:
        return b"mock content"
    return {
        "id": "f-1",
        "filename": "f",
        "purpose": "p",
        "bytes": 0,
        "created_at": time.time(),
    }


def _mock_response_payload(
    method: str,
    endpoint: str,
    call_count: Dict[str, int],
) -> Any:
    base_endpoint = endpoint.split("?")[0]
    if method == "POST" and base_endpoint == "/run":
        task_id = f"mock-{uuid.uuid4().hex[:8]}"
        call_count[task_id] = 0
        return {"taskId": task_id, "status": "processing"}

    if base_endpoint.startswith("/status/"):
        return _mock_status_response(base_endpoint, call_count)

    if base_endpoint.startswith("/results/"):
        task_id = base_endpoint.split("/")[-1]
        return {"taskId": task_id, "status": "completed", "result": MOCK_RESULT}

    if base_endpoint.startswith("/threads"):
        return _mock_thread_response(method, base_endpoint)

    if base_endpoint.startswith("/files"):
        return _mock_file_response(method, base_endpoint)

    return {"status": "ok"}


class TaskForceAIClient:
    """Synchronous TaskForceAI client."""

    def __init__(
        self,
        api_key: str = "",
        *,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = 30.0,
        transport: Optional[httpx.BaseTransport] = None,
        response_hook: Optional[ResponseHook] = None,
        mock_mode: bool = False,
    ) -> None:
        self._mock_mode = mock_mode
        self._mock_call_count: Dict[str, int] = {}

        if not mock_mode and not api_key.strip():
            raise TaskForceAIError("API key must be a non-empty string")

        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._client = httpx.Client(timeout=timeout, transport=transport) if not mock_mode else None
        self._close_finalizer: Optional[weakref.finalize] = None
        if self._client is not None:
            self._close_finalizer = weakref.finalize(
                self,
                TaskForceAIClient._finalize_client,
                self._client,
            )
        self._response_hook = response_hook

    def __enter__(self) -> "TaskForceAIClient":
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        self.close()

    def close(self) -> None:
        client = self._client

        if client is None:
            return

        if self._close_finalizer and self._close_finalizer.alive:
            self._close_finalizer.detach()

        client.close()

    @staticmethod
    def _finalize_client(client: httpx.Client) -> None:
        client.close()

    def _mock_response(
        self,
        method: str,
        endpoint: str,
        json: Optional[Dict[str, Any]] = None,
    ) -> Any:
        """Generate mock responses for development without an API key."""
        return _mock_response_payload(method, endpoint, self._mock_call_count)

    def _request(
        self,
        method: str,
        endpoint: str,
        json: Optional[Dict[str, Any]] = None,
    ) -> Any:
        if self._mock_mode:
            return self._mock_response(method, endpoint, json)

        assert self._client is not None
        url = f"{self._base_url}{endpoint}"
        try:
            response = self._client.request(
                method=method,
                url=url,
                json=json,
                headers=_headers(self._api_key),
                timeout=self._timeout,
            )
            if self._response_hook:
                self._response_hook(response)
            response.raise_for_status()
            return response.json()
        except httpx.TimeoutException as exc:
            raise TaskForceAIError("Request timeout") from exc
        except httpx.HTTPStatusError as exc:
            message = extract_error_message(exc.response)
            raise TaskForceAIError(message, status_code=exc.response.status_code) from exc
        except httpx.HTTPError as exc:
            raise TaskForceAIError(f"Network error: {exc}") from exc

    def submit_task(
        self,
        prompt: str,
        *,
        options: Optional[TaskSubmissionOptions] = None,
        silent: Optional[bool] = None,
        mock: Optional[bool] = None,
        model_id: Optional[str] = None,
        images: Optional[list[ImageAttachment]] = None,
    ) -> TaskId:
        if not prompt.strip():
            raise TaskForceAIError("Prompt must be a non-empty string")

        request_model = TaskSubmissionRequest(
            prompt=prompt,
            options=merge_options(options, silent=silent, mock=mock),
            modelId=model_id,
            attachments=images,
        )

        payload = request_model.model_dump(by_alias=True, exclude_none=True)
        data = self._request("POST", "/run", json=payload)
        return validate_task_status(data).task_id

    def get_task_status(self, task_id: TaskId) -> Any:
        if not str(task_id).strip():
            raise TaskForceAIError("Task ID must be a non-empty string")
        data = self._request("GET", f"/status/{_path_segment(task_id)}")
        return validate_task_status(data)

    def get_task_result(self, task_id: TaskId) -> Any:
        if not str(task_id).strip():
            raise TaskForceAIError("Task ID must be a non-empty string")
        data = self._request("GET", f"/results/{_path_segment(task_id)}")
        return validate_task_status(data)

    def wait_for_completion(
        self,
        task_id: TaskId,
        *,
        poll_interval: float = 2.0,
        max_attempts: int = 150,
        on_status: Optional[TaskStatusCallback] = None,
    ) -> Any:
        consecutive_poll_errors = 0
        max_consecutive_poll_errors = 3

        for _ in range(max_attempts):
            try:
                status = self.get_task_status(task_id)
                consecutive_poll_errors = 0
            except TaskForceAIError as exc:
                consecutive_poll_errors += 1
                if consecutive_poll_errors >= max_consecutive_poll_errors:
                    error_message = (
                        "Task status polling failed after "
                        f"{consecutive_poll_errors} consecutive attempts: {exc}"
                    )
                    raise TaskForceAIError(error_message) from exc
                retry_delay = min(poll_interval * (2 ** (consecutive_poll_errors - 1)), 10.0)
                time.sleep(retry_delay)
                continue

            if on_status:
                on_status(status)
            if status.status == "completed":
                return status
            if status.status == "failed":
                raise TaskForceAIError(getattr(status, "error", "Task failed"))
            if status.status == "awaiting_approval":
                raise TaskForceAIError(
                    getattr(status, "error", None)
                    or getattr(status, "message", None)
                    or "Task is awaiting approval"
                )
            time.sleep(poll_interval)

        raise TaskForceAIError("Task did not complete within the expected time")

    def run_task(
        self,
        prompt: str,
        *,
        options: Optional[TaskSubmissionOptions] = None,
        silent: Optional[bool] = None,
        mock: Optional[bool] = None,
        model_id: Optional[str] = None,
        images: Optional[list[ImageAttachment]] = None,
        poll_interval: float = 2.0,
        max_attempts: int = 150,
        on_status: Optional[TaskStatusCallback] = None,
    ) -> Any:
        task_id = self.submit_task(
            prompt,
            options=options,
            silent=silent,
            mock=mock,
            model_id=model_id,
            images=images,
        )
        return self.wait_for_completion(
            task_id,
            poll_interval=poll_interval,
            max_attempts=max_attempts,
            on_status=on_status,
        )

    def stream_task_status(
        self,
        task_id: TaskId,
        *,
        poll_interval: float = 2.0,
        max_attempts: int = 150,
        on_status: Optional[TaskStatusCallback] = None,
    ) -> TaskStatusStream:
        if not str(task_id).strip():
            raise TaskForceAIError("Task ID must be a non-empty string")
        return TaskStatusStream(
            self,
            task_id,
            poll_interval=poll_interval,
            max_attempts=max_attempts,
            on_status=on_status,
        )

    def run_task_stream(
        self,
        prompt: str,
        *,
        options: Optional[TaskSubmissionOptions] = None,
        silent: Optional[bool] = None,
        mock: Optional[bool] = None,
        model_id: Optional[str] = None,
        images: Optional[list[ImageAttachment]] = None,
        poll_interval: float = 2.0,
        max_attempts: int = 150,
        on_status: Optional[TaskStatusCallback] = None,
    ) -> TaskStatusStream:
        task_id = self.submit_task(
            prompt,
            options=options,
            silent=silent,
            mock=mock,
            model_id=model_id,
            images=images,
        )
        return TaskStatusStream(
            self,
            task_id,
            poll_interval=poll_interval,
            max_attempts=max_attempts,
            on_status=on_status,
        )

    # Thread methods
    def create_thread(
        self,
        options: Optional[CreateThreadOptions] = None,
    ) -> Thread:
        """Create a new conversation thread."""
        payload = options.model_dump(exclude_none=True) if options else {}
        data = self._request("POST", "/threads", json=payload)
        return Thread.model_validate(data)

    def list_threads(
        self,
        limit: int = 20,
        offset: int = 0,
    ) -> ThreadListResponse:
        """List conversation threads."""
        data = self._request("GET", f"/threads?{_pagination_query(limit, offset)}")
        return ThreadListResponse.model_validate(data)

    def get_thread(self, thread_id: int) -> Thread:
        """Get a specific thread by ID."""
        data = self._request("GET", f"/threads/{_thread_path_segment(thread_id)}")
        return Thread.model_validate(data)

    def delete_thread(self, thread_id: int) -> None:
        """Delete a thread by ID."""
        _ = thread_id
        raise TaskForceAIError("delete_thread is not supported by the current Developer API.")

    def get_thread_messages(
        self,
        thread_id: int,
        limit: int = 50,
        offset: int = 0,
    ) -> ThreadMessagesResponse:
        """Get messages from a thread."""
        endpoint = (
            f"/threads/{_thread_path_segment(thread_id)}/messages"
            f"?{_pagination_query(limit, offset)}"
        )
        data = self._request(
            "GET",
            endpoint,
        )
        return ThreadMessagesResponse.model_validate(data)

    def run_in_thread(
        self,
        thread_id: int,
        options: ThreadRunOptions,
    ) -> ThreadRunResponse:
        """Submit a prompt within a thread context."""
        if not options.prompt.strip():
            raise TaskForceAIError("Prompt must be a non-empty string")
        payload = options.model_dump(by_alias=True, exclude_none=True)
        data = self._request(
            "POST",
            f"/threads/{_thread_path_segment(thread_id)}/runs",
            json=payload,
        )
        return ThreadRunResponse.model_validate(data)

    # File methods
    def upload_file(
        self,
        filename: str,
        content: Union[bytes, BinaryIO],
        options: Optional[FileUploadOptions] = None,
    ) -> File:
        """Upload a file."""
        if self._mock_mode:
            return File(
                id="mock-file-id",
                filename=filename,
                purpose=options.purpose if options and options.purpose else "general",
                bytes=0,
                created_at=datetime.fromtimestamp(time.time(), tz=timezone.utc),
            )

        assert self._client is not None
        url = f"{self._base_url}/files"
        files = {"file": (filename, content)}
        data = {}
        if options:
            if options.purpose:
                data["purpose"] = options.purpose
            if options.mime_type:
                data["mime_type"] = options.mime_type

        try:
            response = self._client.post(
                url,
                files=files,
                data=data,
                headers={"x-api-key": self._api_key, "X-SDK-Language": "python"},
                timeout=self._timeout,
            )
            if self._response_hook:
                self._response_hook(response)
            response.raise_for_status()
            return File.model_validate(response.json())
        except httpx.HTTPStatusError as exc:
            message = extract_error_message(exc.response)
            raise TaskForceAIError(message, status_code=exc.response.status_code) from exc
        except httpx.HTTPError as exc:
            raise TaskForceAIError(f"Network error: {exc}") from exc

    def list_files(
        self,
        limit: int = 20,
        offset: int = 0,
    ) -> FileListResponse:
        """List uploaded files."""
        data = self._request("GET", f"/files?{_pagination_query(limit, offset)}")
        return FileListResponse.model_validate(data)

    def get_file(self, file_id: str) -> File:
        """Get file metadata by ID."""
        data = self._request("GET", f"/files/{_path_segment(file_id)}")
        return File.model_validate(data)

    def delete_file(self, file_id: str) -> None:
        """Delete a file by ID."""
        self._request("DELETE", f"/files/{_path_segment(file_id)}")

    def download_file(self, file_id: str) -> bytes:
        """Download file content."""
        if self._mock_mode:
            return b"mock file content"

        assert self._client is not None
        url = f"{self._base_url}/files/{_path_segment(file_id)}/content"
        try:
            response = self._client.get(
                url,
                headers={"x-api-key": self._api_key, "X-SDK-Language": "python"},
                timeout=self._timeout,
            )
            if self._response_hook:
                self._response_hook(response)
            response.raise_for_status()
            return response.content
        except httpx.HTTPStatusError as exc:
            message = extract_error_message(exc.response)
            raise TaskForceAIError(message, status_code=exc.response.status_code) from exc
        except httpx.HTTPError as exc:
            raise TaskForceAIError(f"Network error: {exc}") from exc
