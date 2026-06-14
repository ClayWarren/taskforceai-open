import httpx
import pytest

from taskforceai import AsyncTaskForceAIClient, TaskForceAIClient, TaskForceAIError
from taskforceai.types import TaskSubmissionOptions
from taskforceai.utils import extract_error_message, merge_options


def test_merge_options_applies_overrides() -> None:
    merged = merge_options(
        TaskSubmissionOptions(metadata={"k": "v"}),
        silent=True,
        mock=True,
    )
    assert merged["silent"] is True
    assert merged["mock"] is True
    assert merged["metadata"] == {"k": "v"}


def test_extract_error_message_empty_invalid_json_body() -> None:
    request = httpx.Request("GET", "https://example.com/fail")
    response = httpx.Response(status_code=502, text="", request=request)
    message = extract_error_message(response)
    assert "HTTP 502" in message
    assert "not valid JSON" in message


def test_extract_error_message_non_object_json_body() -> None:
    request = httpx.Request("GET", "https://example.com/fail")
    response = httpx.Response(status_code=400, json=["bad"], request=request)
    assert extract_error_message(response) == '["bad"]'


def test_mock_file_content_request_path() -> None:
    client = TaskForceAIClient(mock_mode=True)
    content = client._request("GET", "/files/file-1/content")
    assert content == b"mock content"
    listing = client._request("GET", "/files")
    assert listing == {"files": [], "total": 0}
    metadata = client._request("GET", "/files/file-1")
    assert metadata["id"] == "f-1"
    client.close()


def test_sync_stream_cancelled() -> None:
    client = TaskForceAIClient(mock_mode=True)
    stream = client.stream_task_status("task-1", poll_interval=0.01, max_attempts=5)
    stream.cancel()
    with pytest.raises(TaskForceAIError, match="cancelled"):
        next(stream)
    client.close()


def test_sync_stream_invokes_status_callback() -> None:
    seen: list[str] = []
    client = TaskForceAIClient(mock_mode=True)
    stream = client.stream_task_status(
        "task-1",
        poll_interval=0,
        on_status=lambda status: seen.append(status.status),
    )
    list(stream)
    assert seen
    client.close()


def test_sync_stream_times_out() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"taskId": "task-1", "status": "processing"},
            request=request,
        )

    client = TaskForceAIClient("key", transport=httpx.MockTransport(handler))
    stream = client.stream_task_status("task-1", poll_interval=0, max_attempts=2)
    with pytest.raises(TaskForceAIError, match="did not complete"):
        list(stream)
    client.close()


@pytest.mark.asyncio
async def test_async_stream_invokes_status_callback() -> None:
    seen: list[str] = []
    async with AsyncTaskForceAIClient(mock_mode=True) as client:
        stream = client.stream_task_status(
            "task-1",
            poll_interval=0,
            on_status=lambda status: seen.append(status.status),
        )
        async for _ in stream:
            pass
    assert seen


@pytest.mark.asyncio
async def test_async_stream_cancelled() -> None:
    async with AsyncTaskForceAIClient(mock_mode=True) as client:
        stream = client.stream_task_status("task-1", poll_interval=0.01, max_attempts=5)
        stream.cancel()
        with pytest.raises(TaskForceAIError, match="cancelled"):
            await stream.__anext__()


def test_async_finalize_client_without_running_loop() -> None:
    transport = httpx.MockTransport(
        lambda request: httpx.Response(200, json={"taskId": "t-1", "status": "completed"})
    )
    client = httpx.AsyncClient(transport=transport)
    AsyncTaskForceAIClient._finalize_client(client)
