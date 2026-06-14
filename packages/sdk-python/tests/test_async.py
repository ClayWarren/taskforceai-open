import asyncio
from typing import Any, Dict, List

import httpx
import pytest

from taskforceai import (
    AsyncTaskForceAIClient,
    CreateThreadOptions,
    FileUploadOptions,
    TaskForceAIError,
    ThreadRunOptions,
)


def build_async_transport(responses: List[Dict[str, Any]]) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if not responses:
            raise AssertionError("Unexpected request")
        spec = responses.pop(0)
        status = spec.get("status", 200)
        json_data = spec.get("json")
        text_data = spec.get("text")

        if "path" in spec:
            assert request.url.path == spec["path"]
        if "method" in spec:
            assert request.method == spec["method"]

        if json_data is not None:
            return httpx.Response(status_code=status, json=json_data)
        return httpx.Response(status_code=status, text=text_data or "")

    return httpx.MockTransport(handler)


@pytest.mark.asyncio
async def test_async_upload_file() -> None:
    captured_requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured_requests.append(request)
        return httpx.Response(
            status_code=200,
            json={
                "id": "af-1",
                "filename": "a.txt",
                "purpose": "p",
                "bytes": 1,
                "created_at": 1672531200,
            },
            request=request,
        )

    transport = httpx.MockTransport(handler)
    async with AsyncTaskForceAIClient("key", transport=transport) as client:
        file = await client.upload_file(
            "a.txt",
            b"c",
            options=FileUploadOptions(purpose="p", mime_type="text/plain"),
        )
        assert file.id == "af-1"
        request = captured_requests[0]
        assert request.url.path == "/api/v1/developer/files"
        assert request.method == "POST"
        assert request.headers["x-api-key"] == "key"
        assert request.headers["x-sdk-language"] == "python"
        body = request.content
        assert b'name="purpose"' in body
        assert b"p" in body
        assert b'name="mime_type"' in body
        assert b"text/plain" in body
        assert b'name="file"; filename="a.txt"' in body
        assert b"c" in body


@pytest.mark.asyncio
async def test_async_mock_upload_file() -> None:
    async with AsyncTaskForceAIClient(mock_mode=True) as client:
        file = await client.upload_file("mock.txt", b"content", FileUploadOptions(purpose="demo"))
        assert file.id == "mock-file-id"
        assert file.filename == "mock.txt"
        assert file.purpose == "demo"
        assert file.bytes == 0


@pytest.mark.asyncio
async def test_async_mock_upload_file_defaults_purpose() -> None:
    async with AsyncTaskForceAIClient(mock_mode=True) as client:
        file = await client.upload_file("mock.txt", b"content")
        assert file.purpose == "general"


@pytest.mark.asyncio
async def test_async_file_ops() -> None:
    transport = build_async_transport(
        [
            {"json": {"files": [], "total": 0}, "path": "/api/v1/developer/files", "method": "GET"},
            {
                "json": {
                    "id": "af-1",
                    "filename": "a",
                    "purpose": "p",
                    "bytes": 1,
                    "created_at": "2023-01-01T00:00:00",
                },
                "path": "/api/v1/developer/files/af-1",
                "method": "GET",
            },
            {"json": {}, "path": "/api/v1/developer/files/af-1", "method": "DELETE"},
            {"text": "c", "path": "/api/v1/developer/files/af-1/content", "method": "GET"},
        ]
    )
    async with AsyncTaskForceAIClient("key", transport=transport) as client:
        await client.list_files()
        await client.get_file("af-1")
        await client.delete_file("af-1")
        assert await client.download_file("af-1") == b"c"


@pytest.mark.asyncio
async def test_async_file_id_path_segments_are_escaped() -> None:
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        if request.method == "GET" and not request.url.raw_path.endswith(b"/content"):
            return httpx.Response(
                200,
                json={
                    "id": "file/team one?",
                    "filename": "f1",
                    "purpose": "p",
                    "bytes": 10,
                    "created_at": "2023-01-01T00:00:00Z",
                },
                request=request,
            )
        if request.method == "DELETE":
            return httpx.Response(200, json={}, request=request)
        return httpx.Response(200, text="file content", request=request)

    async with AsyncTaskForceAIClient(
        "key",
        base_url="https://example.com/api/v1/developer",
        transport=httpx.MockTransport(handler),
    ) as client:
        await client.get_file("file/team one?")
        await client.delete_file("file/team one?")
        await client.download_file("file/team one?")

    assert captured[0].url.raw_path == b"/api/v1/developer/files/file%2Fteam%20one%3F"
    assert captured[1].url.raw_path == b"/api/v1/developer/files/file%2Fteam%20one%3F"
    assert captured[2].url.raw_path == b"/api/v1/developer/files/file%2Fteam%20one%3F/content"


@pytest.mark.asyncio
async def test_async_thread_ops() -> None:
    dt = "2023-01-01T00:00:00"
    transport = build_async_transport(
        [
            {
                "json": {"id": 1, "title": "t", "created_at": dt, "updated_at": dt},
                "path": "/api/v1/developer/threads",
                "method": "POST",
            },
            {
                "json": {"threads": [], "total": 0},
                "path": "/api/v1/developer/threads",
                "method": "GET",
            },
            {
                "json": {"id": 1, "title": "t", "created_at": dt, "updated_at": dt},
                "path": "/api/v1/developer/threads/1",
                "method": "GET",
            },
            {
                "json": {"messages": [], "total": 0},
                "path": "/api/v1/developer/threads/1/messages",
                "method": "GET",
            },
            {
                "json": {
                    "taskId": "t1",
                    "threadId": 1,
                    "messageId": 1,
                    "task_id": "t1",
                    "thread_id": 1,
                    "message_id": 1,
                },
                "path": "/api/v1/developer/threads/1/runs",
                "method": "POST",
            },
        ]
    )
    async with AsyncTaskForceAIClient("key", transport=transport) as client:
        await client.create_thread(CreateThreadOptions(title="t"))
        await client.list_threads()
        await client.get_thread(1)
        with pytest.raises(TaskForceAIError, match="not supported"):
            await client.delete_thread(1)
        await client.get_thread_messages(1)
        await client.run_in_thread(1, ThreadRunOptions(prompt="hi"))


@pytest.mark.asyncio
async def test_async_thread_ops_reject_unsafe_url_inputs() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        raise AssertionError("Unexpected request")

    async with AsyncTaskForceAIClient("key", transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(TaskForceAIError, match="Limit must be an integer"):
            await client.list_threads(limit="20&offset=999")  # type: ignore[arg-type]
        with pytest.raises(TaskForceAIError, match="Offset must be non-negative"):
            await client.list_threads(offset=-1)
        with pytest.raises(TaskForceAIError, match="Thread ID must be an integer"):
            await client.get_thread("1/messages")  # type: ignore[arg-type]
        with pytest.raises(TaskForceAIError, match="Thread ID must be greater than zero"):
            await client.get_thread(0)
        with pytest.raises(TaskForceAIError, match="Thread ID must be an integer"):
            await client.get_thread_messages("1/runs")  # type: ignore[arg-type]
        with pytest.raises(TaskForceAIError, match="Thread ID must be an integer"):
            await client.run_in_thread("1/messages", ThreadRunOptions(prompt="hi"))  # type: ignore[arg-type]

    assert requests == []


@pytest.mark.asyncio
async def test_async_streams() -> None:
    transport = build_async_transport(
        [
            {"json": {"taskId": "s1", "status": "processing"}},
            {"json": {"taskId": "s1", "status": "completed", "result": "ok"}},
        ]
    )
    async with AsyncTaskForceAIClient("key", transport=transport) as client:
        stream = client.stream_task_status("s1", poll_interval=0)
        results = []
        async for status in stream:
            results.append(status)
        assert results[-1].status == "completed"


@pytest.mark.asyncio
async def test_async_streams_stop_on_awaiting_approval() -> None:
    transport = build_async_transport(
        [
            {"json": {"taskId": "s1", "status": "processing"}},
            {
                "json": {
                    "taskId": "s1",
                    "status": "awaiting_approval",
                    "message": "Approval required",
                }
            },
        ]
    )
    async with AsyncTaskForceAIClient("key", transport=transport) as client:
        stream = client.stream_task_status("s1", poll_interval=0)
        results = []
        async for status in stream:
            results.append(status)
        assert results[-1].status == "awaiting_approval"


@pytest.mark.asyncio
async def test_async_stream_cancel() -> None:
    transport = build_async_transport(
        [
            {"json": {"taskId": "s-cancel", "status": "processing"}},
        ]
    )
    async with AsyncTaskForceAIClient("key", transport=transport) as client:
        stream = client.stream_task_status("s-cancel", poll_interval=0, max_attempts=2)
        first = await stream.__anext__()
        assert first.status == "processing"
        stream.cancel()
        with pytest.raises(TaskForceAIError, match="cancelled"):
            await stream.__anext__()


@pytest.mark.asyncio
async def test_async_stream_cancel_wakes_pending_sleep() -> None:
    transport = build_async_transport(
        [
            {"json": {"taskId": "s-cancel-sleep", "status": "processing"}},
        ]
    )
    async with AsyncTaskForceAIClient("key", transport=transport) as client:
        stream = client.stream_task_status("s-cancel-sleep", poll_interval=10, max_attempts=2)
        first = await stream.__anext__()
        assert first.status == "processing"

        pending = asyncio.create_task(stream.__anext__())
        await asyncio.sleep(0)
        stream.cancel()

        with pytest.raises(TaskForceAIError, match="cancelled"):
            await asyncio.wait_for(pending, timeout=0.2)


@pytest.mark.asyncio
async def test_async_stream_max_attempts_error() -> None:
    transport = build_async_transport(
        [
            {"json": {"taskId": "s-timeout", "status": "processing"}},
            {"json": {"taskId": "s-timeout", "status": "processing"}},
        ]
    )
    async with AsyncTaskForceAIClient("key", transport=transport) as client:
        stream = client.stream_task_status("s-timeout", poll_interval=0, max_attempts=2)
        results = []
        with pytest.raises(TaskForceAIError, match="expected time"):
            async for status in stream:
                results.append(status)
        assert len(results) == 2


@pytest.mark.asyncio
async def test_async_stream_parse_error_propagates() -> None:
    transport = build_async_transport(
        [
            {"json": {"invalid": "payload"}},
        ]
    )
    async with AsyncTaskForceAIClient("key", transport=transport) as client:
        stream = client.stream_task_status("s-parse", poll_interval=0, max_attempts=1)
        with pytest.raises(TaskForceAIError, match="Invalid API response"):
            await stream.__anext__()


@pytest.mark.asyncio
async def test_async_run_task_stream() -> None:
    transport = build_async_transport(
        [
            {"json": {"taskId": "s2", "status": "processing"}},  # submit
            {"json": {"taskId": "s2", "status": "completed", "result": "ok"}},  # stream
        ]
    )
    async with AsyncTaskForceAIClient("key", transport=transport) as client:
        stream = await client.run_task_stream("hi", poll_interval=0)
        async for status in stream:
            if status.status == "completed":
                break
