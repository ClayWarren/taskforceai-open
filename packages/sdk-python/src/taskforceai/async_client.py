from __future__ import annotations

import asyncio
import time
import weakref
from datetime import datetime, timezone
from types import TracebackType
from typing import Any, BinaryIO, Dict, Optional, Union

import httpx

from .exceptions import TaskForceAIError
from .files import File, FileListResponse, FileUploadOptions
from .models import ImageAttachment, TaskId, TaskSubmissionRequest
from .streams import AsyncTaskStatusStream
from .sync_client import (
    DEFAULT_BASE_URL,
    _headers,
    _mock_response_payload,
    _pagination_query,
    _path_segment,
    _thread_path_segment,
)
from .threads import (
    CreateThreadOptions,
    Thread,
    ThreadListResponse,
    ThreadMessagesResponse,
    ThreadRunOptions,
    ThreadRunResponse,
)
from .types import ResponseHook, TaskStatusCallback, TaskSubmissionOptions
from .utils import (
    extract_error_message,
    merge_options,
    parse_success_json,
    validate_response_model,
    validate_task_status,
)


class AsyncTaskForceAIClient:
    """Asynchronous TaskForceAI client."""

    def __init__(
        self,
        api_key: str = "",
        *,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = 30.0,
        transport: Optional[httpx.AsyncBaseTransport] = None,
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
        self._client = (
            httpx.AsyncClient(timeout=timeout, transport=transport) if not mock_mode else None
        )
        self._close_finalizer: Optional[weakref.finalize] = None
        if self._client is not None:
            self._close_finalizer = weakref.finalize(
                self,
                AsyncTaskForceAIClient._finalize_client,
                self._client,
            )
        self._response_hook = response_hook

    async def __aenter__(self) -> "AsyncTaskForceAIClient":
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        await self.close()

    async def close(self) -> None:
        client = self._client

        if client is None:
            return

        if self._close_finalizer and self._close_finalizer.alive:
            self._close_finalizer.detach()

        await client.aclose()

    @staticmethod
    def _finalize_client(client: httpx.AsyncClient) -> None:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            try:
                loop.run_until_complete(client.aclose())
            finally:
                loop.close()
            return

        if loop.is_closed():
            return

        try:
            asyncio.run_coroutine_threadsafe(client.aclose(), loop)
        except RuntimeError:
            return

    def _mock_response(
        self,
        method: str,
        endpoint: str,
        json: Optional[Dict[str, Any]] = None,
    ) -> Any:
        """Generate mock responses for development without an API key."""
        return _mock_response_payload(method, endpoint, self._mock_call_count)

    async def _request(
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
            response = await self._client.request(
                method=method,
                url=url,
                json=json,
                headers=_headers(self._api_key),
                timeout=self._timeout,
            )
            if self._response_hook:
                self._response_hook(response)
            response.raise_for_status()
            return parse_success_json(response)
        except httpx.TimeoutException as exc:
            raise TaskForceAIError("Request timeout") from exc
        except httpx.HTTPStatusError as exc:
            message = extract_error_message(exc.response)
            raise TaskForceAIError(message, status_code=exc.response.status_code) from exc
        except httpx.HTTPError as exc:
            raise TaskForceAIError(f"Network error: {exc}") from exc

    async def submit_task(
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

        data = await self._request("POST", "/run", json=payload)
        return validate_task_status(data).task_id

    async def get_task_status(self, task_id: TaskId) -> Any:
        if not str(task_id).strip():
            raise TaskForceAIError("Task ID must be a non-empty string")
        data = await self._request("GET", f"/status/{_path_segment(task_id)}")
        return validate_task_status(data)

    async def get_task_result(self, task_id: TaskId) -> Any:
        if not str(task_id).strip():
            raise TaskForceAIError("Task ID must be a non-empty string")
        data = await self._request("GET", f"/results/{_path_segment(task_id)}")
        return validate_task_status(data)

    async def wait_for_completion(
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
                status = await self.get_task_status(task_id)
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
                await asyncio.sleep(retry_delay)
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
            await asyncio.sleep(poll_interval)

        raise TaskForceAIError("Task did not complete within the expected time")

    async def run_task(
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
        task_id = await self.submit_task(
            prompt,
            options=options,
            silent=silent,
            mock=mock,
            model_id=model_id,
            images=images,
        )
        return await self.wait_for_completion(
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
    ) -> AsyncTaskStatusStream:
        if not str(task_id).strip():
            raise TaskForceAIError("Task ID must be a non-empty string")
        return AsyncTaskStatusStream(
            self,
            task_id,
            poll_interval=poll_interval,
            max_attempts=max_attempts,
            on_status=on_status,
        )

    async def run_task_stream(
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
    ) -> AsyncTaskStatusStream:
        task_id = await self.submit_task(
            prompt,
            options=options,
            silent=silent,
            mock=mock,
            model_id=model_id,
            images=images,
        )
        return AsyncTaskStatusStream(
            self,
            task_id,
            poll_interval=poll_interval,
            max_attempts=max_attempts,
            on_status=on_status,
        )

    # Thread methods
    async def create_thread(
        self,
        options: Optional[CreateThreadOptions] = None,
    ) -> Thread:
        """Create a new conversation thread."""
        payload = options.model_dump(exclude_none=True) if options else {}
        data = await self._request("POST", "/threads", json=payload)
        return validate_response_model(Thread, data, "thread")

    async def list_threads(
        self,
        limit: int = 20,
        offset: int = 0,
    ) -> ThreadListResponse:
        """List conversation threads."""
        data = await self._request("GET", f"/threads?{_pagination_query(limit, offset)}")
        return validate_response_model(ThreadListResponse, data, "thread list")

    async def get_thread(self, thread_id: int) -> Thread:
        """Get a specific thread by ID."""
        data = await self._request("GET", f"/threads/{_thread_path_segment(thread_id)}")
        return validate_response_model(Thread, data, "thread")

    async def delete_thread(self, thread_id: int) -> None:
        """Delete a thread by ID."""
        _ = thread_id
        raise TaskForceAIError("delete_thread is not supported by the current Developer API.")

    async def get_thread_messages(
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
        data = await self._request(
            "GET",
            endpoint,
        )
        return validate_response_model(ThreadMessagesResponse, data, "thread messages")

    async def run_in_thread(
        self,
        thread_id: int,
        options: ThreadRunOptions,
    ) -> ThreadRunResponse:
        """Submit a prompt within a thread context."""
        if not options.prompt.strip():
            raise TaskForceAIError("Prompt must be a non-empty string")
        payload = options.model_dump(by_alias=True, exclude_none=True)
        data = await self._request(
            "POST", f"/threads/{_thread_path_segment(thread_id)}/runs", json=payload
        )
        return validate_response_model(ThreadRunResponse, data, "thread run")

    # File methods
    async def upload_file(
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
            response = await self._client.post(
                url,
                files=files,
                data=data,
                headers={"x-api-key": self._api_key, "X-SDK-Language": "python"},
                timeout=self._timeout,
            )
            if self._response_hook:
                self._response_hook(response)
            response.raise_for_status()
            return validate_response_model(File, parse_success_json(response), "file")
        except httpx.HTTPStatusError as exc:
            message = extract_error_message(exc.response)
            raise TaskForceAIError(message, status_code=exc.response.status_code) from exc
        except httpx.HTTPError as exc:
            raise TaskForceAIError(f"Network error: {exc}") from exc

    async def list_files(
        self,
        limit: int = 20,
        offset: int = 0,
    ) -> FileListResponse:
        """List uploaded files."""
        data = await self._request("GET", f"/files?{_pagination_query(limit, offset)}")
        return validate_response_model(FileListResponse, data, "file list")

    async def get_file(self, file_id: str) -> File:
        """Get file metadata by ID."""
        data = await self._request("GET", f"/files/{_path_segment(file_id)}")
        return validate_response_model(File, data, "file")

    async def delete_file(self, file_id: str) -> None:
        """Delete a file by ID."""
        await self._request("DELETE", f"/files/{_path_segment(file_id)}")

    async def download_file(self, file_id: str) -> bytes:
        """Download file content."""
        if self._mock_mode:
            return b"mock file content"

        assert self._client is not None
        url = f"{self._base_url}/files/{_path_segment(file_id)}/content"
        try:
            response = await self._client.get(
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
