from __future__ import annotations

from typing import Any, Dict, List

import httpx
import pytest

import taskforceai.async_client as async_client_module
from client_helpers import build_transport
from taskforceai import (
    AsyncTaskForceAIClient,
    FileUploadOptions,
    TaskAwaitingApproval,
    TaskForceAIError,
    TaskStatusResponse,
    ThreadRunOptions,
)


@pytest.mark.asyncio
async def test_async_run_task_success() -> None:
    transport = build_transport(
        [
            {
                "status": 200,
                "json": {"taskId": "task_async", "status": "processing"},
                "path": "/api/v1/developer/run",
                "method": "POST",
            },
            {
                "status": 200,
                "json": {"taskId": "task_async", "status": "completed", "result": "async result"},
                "path": "/api/v1/developer/status/task_async",
                "method": "GET",
            },
        ]
    )
    async with AsyncTaskForceAIClient(
        "key",
        base_url="https://example.com/api/v1/developer",
        transport=transport,
    ) as client:
        result = await client.run_task("Async task", poll_interval=0.01, max_attempts=2)

    assert result.task_id == "task_async"
    assert result.result == "async result"
    assert result.status == "completed"


@pytest.mark.asyncio
async def test_async_client_validates_api_key() -> None:
    with pytest.raises(TaskForceAIError):
        AsyncTaskForceAIClient("")


@pytest.mark.asyncio
async def test_async_client_context_manager_closes_client() -> None:
    captured: AsyncTaskForceAIClient | None = None

    async with AsyncTaskForceAIClient("key") as client:
        captured = client
        assert not client._client.is_closed

    assert captured is not None
    assert captured._client.is_closed


@pytest.mark.asyncio
async def test_async_submit_task_validates_prompt() -> None:
    client = AsyncTaskForceAIClient("key")
    with pytest.raises(TaskForceAIError, match="Prompt must be a non-empty string"):
        await client.submit_task(" ")
    await client.close()


@pytest.mark.asyncio
async def test_async_client_request_timeout() -> None:
    async def handler(_: httpx.Request) -> httpx.Response:
        raise httpx.TimeoutException("timeout")

    client = AsyncTaskForceAIClient("key", transport=httpx.MockTransport(handler))

    with pytest.raises(TaskForceAIError, match="Request timeout"):
        await client.get_task_status("task")

    await client.close()


@pytest.mark.asyncio
async def test_async_get_task_status_validates_input() -> None:
    client = AsyncTaskForceAIClient("key")
    with pytest.raises(TaskForceAIError, match="Task ID must be a non-empty string"):
        await client.get_task_status(" ")
    await client.close()


@pytest.mark.asyncio
async def test_async_get_task_result_validates_input() -> None:
    client = AsyncTaskForceAIClient("key")
    with pytest.raises(TaskForceAIError, match="Task ID must be a non-empty string"):
        await client.get_task_result("")
    await client.close()


@pytest.mark.asyncio
async def test_async_task_id_path_segments_are_escaped() -> None:
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(
            200,
            json={"taskId": "team/one task?", "status": "completed", "result": "done"},
            request=request,
        )

    client = AsyncTaskForceAIClient(
        "key",
        base_url="https://example.com/api/v1/developer",
        transport=httpx.MockTransport(handler),
    )

    await client.get_task_status("team/one task?")
    await client.get_task_result("team/one task?")

    assert captured[0].url.raw_path == b"/api/v1/developer/status/team%2Fone%20task%3F"
    assert captured[1].url.raw_path == b"/api/v1/developer/results/team%2Fone%20task%3F"
    await client.close()


@pytest.mark.asyncio
async def test_async_submit_task_error_with_object_payload() -> None:
    transport = build_transport(
        [
            {
                "status": 422,
                "json": {"error": ["Invalid"]},
                "path": "/api/v1/developer/run",
                "method": "POST",
            }
        ]
    )
    client = AsyncTaskForceAIClient(
        "key",
        base_url="https://example.com/api/v1/developer",
        transport=transport,
    )

    with pytest.raises(TaskForceAIError) as exc:
        await client.submit_task("prompt")

    assert "['Invalid']" in str(exc.value)
    await client.close()


@pytest.mark.asyncio
async def test_async_submit_task_missing_task_id() -> None:
    transport = build_transport(
        [
            {
                "status": 200,
                "json": {"message": "ok"},
                "path": "/api/v1/developer/run",
                "method": "POST",
            }
        ]
    )
    client = AsyncTaskForceAIClient(
        "key",
        base_url="https://example.com/api/v1/developer",
        transport=transport,
    )

    with pytest.raises(TaskForceAIError, match="Invalid API response"):
        await client.submit_task("prompt")

    await client.close()


@pytest.mark.asyncio
async def test_async_submit_task_malformed_success_json_raises_sdk_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="{", request=request)

    client = AsyncTaskForceAIClient(
        "key",
        base_url="https://example.com/api/v1/developer",
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(TaskForceAIError, match="Invalid JSON response from API") as exc:
        await client.submit_task("prompt")

    assert exc.value.status_code == 200
    await client.close()


@pytest.mark.asyncio
async def test_async_client_network_error() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        raise httpx.TransportError("boom")

    client = AsyncTaskForceAIClient("key", transport=httpx.MockTransport(handler))

    with pytest.raises(TaskForceAIError, match="Network error: boom"):
        await client.get_task_status("task")

    await client.close()


@pytest.mark.asyncio
async def test_async_response_hook_receives_response() -> None:
    captured_statuses: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"taskId": "task_hook", "status": "completed", "result": "ok"},
            request=request,
        )

    client = AsyncTaskForceAIClient(
        "key",
        transport=httpx.MockTransport(handler),
        response_hook=lambda response: captured_statuses.append(response.status_code),
    )

    status = await client.get_task_status("task_hook")

    assert status.result == "ok"
    assert captured_statuses == [200]
    await client.close()


@pytest.mark.asyncio
async def test_async_get_task_result_success() -> None:
    transport = build_transport(
        [
            {
                "status": 200,
                "json": {"taskId": "task_async", "status": "completed", "result": "value"},
                "path": "/api/v1/developer/results/task_async",
                "method": "GET",
            }
        ]
    )
    client = AsyncTaskForceAIClient(
        "key",
        base_url="https://example.com/api/v1/developer",
        transport=transport,
    )

    result = await client.get_task_result("task_async")

    assert result.result == "value"
    await client.close()


@pytest.mark.asyncio
async def test_async_wait_for_completion_failure() -> None:
    responses: List[Dict[str, Any]] = [
        {
            "status": 200,
            "json": {"taskId": "id", "status": "failed", "error": "Unable"},
            "path": "/api/v1/developer/status/id",
            "method": "GET",
        },
    ]

    async def handler(request: httpx.Request) -> httpx.Response:
        if not responses:
            raise AssertionError("Unexpected request")
        spec = responses.pop(0)
        assert request.url.path == spec["path"]
        assert request.method == spec["method"]
        return httpx.Response(status_code=spec["status"], json=spec["json"], request=request)

    client = AsyncTaskForceAIClient(
        "key",
        base_url="https://example.com/api/v1/developer",
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(TaskForceAIError, match="Unable"):
        await client.wait_for_completion("id", poll_interval=0.0, max_attempts=1)

    await client.close()


@pytest.mark.asyncio
async def test_async_wait_for_completion_awaiting_approval() -> None:
    responses: List[Dict[str, Any]] = [
        {
            "status": 200,
            "json": {
                "taskId": "task_async_approval",
                "status": "awaiting_approval",
                "message": "Approval required",
            },
            "path": "/api/v1/developer/status/task_async_approval",
            "method": "GET",
        },
    ]

    async def handler(request: httpx.Request) -> httpx.Response:
        if not responses:
            raise AssertionError("Unexpected request")
        spec = responses.pop(0)
        assert request.url.path == spec["path"]
        assert request.method == spec["method"]
        return httpx.Response(status_code=spec["status"], json=spec["json"], request=request)

    client = AsyncTaskForceAIClient(
        "key",
        base_url="https://example.com/api/v1/developer",
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(TaskForceAIError, match="Approval required"):
        await client.wait_for_completion("task_async_approval", poll_interval=0.0, max_attempts=1)

    await client.close()


@pytest.mark.asyncio
async def test_async_wait_for_completion_canceled() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"taskId": "task_canceled", "status": "canceled", "error": "Run canceled"},
            request=request,
        )

    client = AsyncTaskForceAIClient("key", transport=httpx.MockTransport(handler))

    with pytest.raises(TaskForceAIError, match="Run canceled"):
        await client.wait_for_completion("task_canceled", poll_interval=0.0, max_attempts=1)

    await client.close()


@pytest.mark.asyncio
async def test_async_wait_for_completion_does_not_retry_permanent_http_errors() -> None:
    attempts = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        return httpx.Response(403, json={"error": "Forbidden"}, request=request)

    client = AsyncTaskForceAIClient("key", transport=httpx.MockTransport(handler))

    with pytest.raises(TaskForceAIError) as exc:
        await client.wait_for_completion("task_denied", poll_interval=0.0, max_attempts=5)

    assert exc.value.status_code == 403
    assert attempts == 1
    await client.close()


@pytest.mark.asyncio
async def test_async_wait_for_completion_retries_transient_poll_error() -> None:
    attempts = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        assert request.url.path == "/api/v1/developer/status/task_async_retry"
        if attempts == 1:
            raise httpx.TransportError("temporary outage")
        if attempts == 2:
            return httpx.Response(
                status_code=200,
                json={"taskId": "task_async_retry", "status": "processing"},
                request=request,
            )
        return httpx.Response(
            status_code=200,
            json={"taskId": "task_async_retry", "status": "completed", "result": "done"},
            request=request,
        )

    client = AsyncTaskForceAIClient(
        "key",
        base_url="https://example.com/api/v1/developer",
        transport=httpx.MockTransport(handler),
    )

    result = await client.wait_for_completion("task_async_retry", poll_interval=0.0, max_attempts=5)

    assert attempts == 3
    assert result.status == "completed"
    await client.close()


@pytest.mark.asyncio
async def test_async_wait_for_completion_stops_after_repeated_poll_errors() -> None:
    attempts = 0

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        raise httpx.TransportError("still down")

    client = AsyncTaskForceAIClient("key", transport=httpx.MockTransport(handler))

    with pytest.raises(TaskForceAIError, match="3 consecutive attempts"):
        await client.wait_for_completion("task_down", poll_interval=0.0, max_attempts=5)

    assert attempts == 3
    await client.close()


@pytest.mark.asyncio
async def test_async_wait_for_completion_timeout() -> None:
    transport = build_transport(
        [
            {
                "status": 200,
                "json": {"taskId": "task_timeout", "status": "processing"},
                "path": "/api/v1/developer/status/task_timeout",
            },
            {
                "status": 200,
                "json": {"taskId": "task_timeout", "status": "processing"},
                "path": "/api/v1/developer/status/task_timeout",
            },
        ]
    )
    client = AsyncTaskForceAIClient(
        "key",
        base_url="https://example.com/api/v1/developer",
        transport=transport,
    )

    with pytest.raises(TaskForceAIError, match="expected time"):
        await client.wait_for_completion("task_timeout", poll_interval=0.0, max_attempts=2)

    await client.close()


@pytest.mark.asyncio
async def test_async_stream_task_status() -> None:
    transport = build_transport(
        [
            {
                "status": 200,
                "json": {"taskId": "async_stream", "status": "processing"},
                "path": "/api/v1/developer/status/async_stream",
            },
            {
                "status": 200,
                "json": {"taskId": "async_stream", "status": "completed", "result": "ok"},
                "path": "/api/v1/developer/status/async_stream",
            },
        ]
    )
    client = AsyncTaskForceAIClient(
        "key",
        base_url="https://example.com/api/v1/developer",
        transport=transport,
    )

    stream = client.stream_task_status("async_stream", poll_interval=0.0, max_attempts=2)
    statuses: List[TaskStatusResponse] = []
    async for status in stream:
        statuses.append(status)

    assert statuses[-1].status == "completed"
    await client.close()


@pytest.mark.asyncio
async def test_async_stream_task_status_stops_on_awaiting_approval() -> None:
    transport = build_transport(
        [
            {
                "status": 200,
                "json": {"taskId": "async_stream", "status": "processing"},
                "path": "/api/v1/developer/status/async_stream",
            },
            {
                "status": 200,
                "json": {
                    "taskId": "async_stream",
                    "status": "awaiting_approval",
                    "message": "Approval required",
                },
                "path": "/api/v1/developer/status/async_stream",
            },
        ]
    )
    client = AsyncTaskForceAIClient(
        "key",
        base_url="https://example.com/api/v1/developer",
        transport=transport,
    )

    stream = client.stream_task_status("async_stream", poll_interval=0.0, max_attempts=3)
    statuses: List[TaskStatusResponse] = []
    async for status in stream:
        statuses.append(status)

    assert statuses[-1].status == "awaiting_approval"
    assert isinstance(statuses[-1], TaskAwaitingApproval)
    await client.close()


@pytest.mark.asyncio
async def test_async_stream_task_status_validates_input() -> None:
    client = AsyncTaskForceAIClient("key")

    with pytest.raises(TaskForceAIError, match="Task ID must be a non-empty string"):
        client.stream_task_status(" ")

    await client.close()


@pytest.mark.asyncio
async def test_async_run_in_thread_validates_prompt() -> None:
    client = AsyncTaskForceAIClient("key")

    with pytest.raises(TaskForceAIError, match="Prompt must be a non-empty string"):
        await client.run_in_thread(1, ThreadRunOptions(prompt=" "))

    await client.close()


@pytest.mark.asyncio
async def test_async_upload_file_sends_metadata_and_invokes_response_hook() -> None:
    captured_requests: list[httpx.Request] = []
    captured_statuses: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured_requests.append(request)
        return httpx.Response(
            200,
            json={
                "id": "file-async",
                "filename": "async.txt",
                "purpose": "assistants",
                "bytes": 7,
                "created_at": "2023-01-01T00:00:00Z",
            },
            request=request,
        )

    client = AsyncTaskForceAIClient(
        "key",
        transport=httpx.MockTransport(handler),
        response_hook=lambda response: captured_statuses.append(response.status_code),
    )

    uploaded = await client.upload_file(
        "async.txt",
        b"content",
        FileUploadOptions(purpose="assistants", mime_type="text/plain"),
    )

    assert uploaded.id == "file-async"
    assert captured_statuses == [200]
    body = captured_requests[0].content
    assert b'name="purpose"' in body
    assert b"assistants" in body
    assert b'name="mime_type"' in body
    assert b"text/plain" in body
    await client.close()


@pytest.mark.asyncio
async def test_async_upload_file_error_paths() -> None:
    def http_error_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(415, json={"error": "Unsupported file"}, request=request)

    client = AsyncTaskForceAIClient("key", transport=httpx.MockTransport(http_error_handler))

    with pytest.raises(TaskForceAIError) as exc:
        await client.upload_file("bad.bin", b"bad")

    assert exc.value.status_code == 415
    assert "Unsupported file" in str(exc.value)
    await client.close()

    def network_error_handler(_: httpx.Request) -> httpx.Response:
        raise httpx.TransportError("offline")

    client = AsyncTaskForceAIClient("key", transport=httpx.MockTransport(network_error_handler))

    with pytest.raises(TaskForceAIError, match="Network error: offline"):
        await client.upload_file("bad.bin", b"bad")

    await client.close()


@pytest.mark.asyncio
async def test_async_upload_file_malformed_success_json_raises_sdk_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="{", request=request)

    client = AsyncTaskForceAIClient("key", transport=httpx.MockTransport(handler))

    with pytest.raises(TaskForceAIError, match="Invalid JSON response from API") as exc:
        await client.upload_file("bad.bin", b"bad")

    assert exc.value.status_code == 200
    await client.close()


@pytest.mark.asyncio
async def test_async_upload_attachment_mock_mode_returns_mock_id() -> None:
    client = AsyncTaskForceAIClient(mock_mode=True)

    attachment_id = await client.upload_attachment("mock.txt", b"content", "text/plain")

    assert attachment_id == "mock-attachment-id"
    await client.close()


@pytest.mark.asyncio
async def test_async_upload_attachment_sends_file_and_invokes_response_hook() -> None:
    captured_requests: list[httpx.Request] = []
    captured_statuses: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured_requests.append(request)
        return httpx.Response(200, json={"id": "attachment-async"}, request=request)

    client = AsyncTaskForceAIClient(
        "key",
        base_url="https://example.com/api/v1/developer",
        transport=httpx.MockTransport(handler),
        response_hook=lambda response: captured_statuses.append(response.status_code),
    )

    attachment_id = await client.upload_attachment(
        "attachment.txt",
        b"content",
        "text/plain",
    )

    assert attachment_id == "attachment-async"
    assert captured_statuses == [200]
    assert captured_requests[0].url.path == "/api/v1/attachments/upload"
    assert b'name="file"' in captured_requests[0].content
    assert b"attachment.txt" in captured_requests[0].content
    await client.close()


@pytest.mark.asyncio
async def test_async_upload_attachment_error_paths() -> None:
    def invalid_response_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={}, request=request)

    client = AsyncTaskForceAIClient(
        "key",
        transport=httpx.MockTransport(invalid_response_handler),
    )

    with pytest.raises(TaskForceAIError, match="Invalid attachment upload response from API"):
        await client.upload_attachment("bad.txt", b"bad")

    await client.close()

    def http_error_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(413, json={"error": "Too large"}, request=request)

    client = AsyncTaskForceAIClient("key", transport=httpx.MockTransport(http_error_handler))

    with pytest.raises(TaskForceAIError) as exc:
        await client.upload_attachment("large.bin", b"x")

    assert exc.value.status_code == 413
    assert "Too large" in str(exc.value)
    await client.close()

    def network_error_handler(_: httpx.Request) -> httpx.Response:
        raise httpx.TransportError("upload down")

    client = AsyncTaskForceAIClient("key", transport=httpx.MockTransport(network_error_handler))

    with pytest.raises(TaskForceAIError, match="Network error: upload down"):
        await client.upload_attachment("offline.bin", b"x")

    await client.close()


@pytest.mark.asyncio
async def test_async_download_file_error_paths() -> None:
    captured_statuses: list[int] = []

    def http_error_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"error": "Missing file"}, request=request)

    client = AsyncTaskForceAIClient(
        "key",
        transport=httpx.MockTransport(http_error_handler),
        response_hook=lambda response: captured_statuses.append(response.status_code),
    )

    with pytest.raises(TaskForceAIError) as exc:
        await client.download_file("missing")

    assert exc.value.status_code == 404
    assert "Missing file" in str(exc.value)
    assert captured_statuses == [404]
    await client.close()

    def network_error_handler(_: httpx.Request) -> httpx.Response:
        raise httpx.TransportError("connection reset")

    client = AsyncTaskForceAIClient("key", transport=httpx.MockTransport(network_error_handler))

    with pytest.raises(TaskForceAIError, match="Network error: connection reset"):
        await client.download_file("file-1")

    await client.close()


def test_async_client_finalizer_schedules_close_on_running_loop(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class DummyAsyncClient:
        async def aclose(self) -> None:
            return

    class DummyLoop:
        def is_closed(self) -> bool:
            return False

    dummy_loop = DummyLoop()
    scheduled = {"called": False}

    def fake_get_running_loop() -> DummyLoop:
        return dummy_loop

    def fake_run_coroutine_threadsafe(coro: Any, loop: Any) -> object:
        scheduled["called"] = True
        assert loop is dummy_loop
        coro.close()
        return object()

    monkeypatch.setattr(async_client_module.asyncio, "get_running_loop", fake_get_running_loop)
    monkeypatch.setattr(
        async_client_module.asyncio,
        "run_coroutine_threadsafe",
        fake_run_coroutine_threadsafe,
    )

    AsyncTaskForceAIClient._finalize_client(DummyAsyncClient())
    assert scheduled["called"] is True
