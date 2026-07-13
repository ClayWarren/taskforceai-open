from __future__ import annotations

import asyncio
import weakref
from types import TracebackType
from typing import Any, BinaryIO, Dict, Optional, Union

import httpx

from .exceptions import TaskForceAIError
from .files import File, FileListResponse, FileUploadOptions
from .models import ImageAttachment, TaskId, TaskSubmissionRequest
from .streams import AsyncTaskStatusStream
from .sync_client import (
    DEFAULT_BASE_URL,
    _attachment_base_url,
    _decode_image_attachment,
    _headers,
    _is_retryable_poll_error,
    _mock_response_payload,
    _pagination_query,
    _path_segment,
    _task_path_segment,
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
    checked_response_content,
    file_upload_data,
    merge_options,
    mock_uploaded_file,
    parse_attachment_upload_response,
    parse_checked_response,
    parse_file_upload_response,
    resolve_terminal_task_status,
    translate_http_errors,
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

    async def _request(
        self,
        method: str,
        endpoint: str,
        json: Optional[Dict[str, Any]] = None,
    ) -> Any:
        if self._mock_mode:
            return _mock_response_payload(method, endpoint, self._mock_call_count)

        assert self._client is not None
        url = f"{self._base_url}{endpoint}"
        with translate_http_errors("Request timeout"):
            response = await self._client.request(
                method=method,
                url=url,
                json=json,
                headers=_headers(self._api_key),
                timeout=self._timeout,
            )
            return parse_checked_response(response, self._response_hook)

    async def submit_task(
        self,
        prompt: str,
        *,
        options: Optional[TaskSubmissionOptions] = None,
        silent: Optional[bool] = None,
        mock: Optional[bool] = None,
        model_id: Optional[str] = None,
        attachment_ids: Optional[list[str]] = None,
        images: Optional[list[ImageAttachment]] = None,
    ) -> TaskId:
        if not prompt.strip():
            raise TaskForceAIError("Prompt must be a non-empty string")

        resolved_attachment_ids = list(attachment_ids or [])
        if images:
            for image in images:
                resolved_attachment_ids.append(
                    await self.upload_attachment(
                        image.name or "attachment",
                        _decode_image_attachment(image),
                        image.mime_type,
                    )
                )

        request_model = TaskSubmissionRequest(
            prompt=prompt,
            options=merge_options(options, silent=silent, mock=mock),
            modelId=model_id,
            attachment_ids=resolved_attachment_ids or None,
        )
        payload = request_model.model_dump(by_alias=True, exclude_none=True)

        data = await self._request("POST", "/run", json=payload)
        return validate_task_status(data).task_id

    async def get_task_status(self, task_id: TaskId) -> Any:
        data = await self._request("GET", f"/status/{_task_path_segment(task_id)}")
        return validate_task_status(data)

    async def get_task_result(self, task_id: TaskId) -> Any:
        data = await self._request("GET", f"/results/{_task_path_segment(task_id)}")
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
                if not _is_retryable_poll_error(exc):
                    raise
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
            completed = resolve_terminal_task_status(status)
            if completed is not None:
                return completed
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
        attachment_ids: Optional[list[str]] = None,
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
            attachment_ids=attachment_ids,
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
        _task_path_segment(task_id)
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
        attachment_ids: Optional[list[str]] = None,
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
            attachment_ids=attachment_ids,
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
        payload = options.model_dump(exclude_none=True, include={"title"}) if options else {}
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
        payload = options.model_dump(by_alias=True, exclude_none=True, exclude={"options"})
        data = await self._request(
            "POST", f"/threads/{_thread_path_segment(thread_id)}/runs", json=payload
        )
        return validate_response_model(ThreadRunResponse, data, "thread run")

    # File methods
    async def upload_attachment(
        self,
        filename: str,
        content: Union[bytes, BinaryIO],
        mime_type: str = "application/octet-stream",
    ) -> str:
        """Upload a transient task attachment and return its attachment ID."""
        if self._mock_mode:
            return "mock-attachment-id"

        assert self._client is not None
        url = f"{_attachment_base_url(self._base_url)}/attachments/upload"
        files = {"file": (filename, content, mime_type)}
        with translate_http_errors():
            response = await self._client.post(
                url,
                files=files,
                headers={"x-api-key": self._api_key, "X-SDK-Language": "python"},
                timeout=self._timeout,
            )
            return parse_attachment_upload_response(response, self._response_hook)

    async def upload_file(
        self,
        filename: str,
        content: Union[bytes, BinaryIO],
        options: Optional[FileUploadOptions] = None,
    ) -> File:
        """Upload a file."""
        if self._mock_mode:
            return mock_uploaded_file(filename, options)

        assert self._client is not None
        url = f"{self._base_url}/files"
        files = {"file": (filename, content)}

        with translate_http_errors():
            response = await self._client.post(
                url,
                files=files,
                data=file_upload_data(options),
                headers={"x-api-key": self._api_key, "X-SDK-Language": "python"},
                timeout=self._timeout,
            )
            return parse_file_upload_response(response, self._response_hook)

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
        with translate_http_errors():
            response = await self._client.get(
                url,
                headers={"x-api-key": self._api_key, "X-SDK-Language": "python"},
                timeout=self._timeout,
            )
            return checked_response_content(response, self._response_hook)
