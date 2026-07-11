import json

import httpx
import pytest

import taskforceai.async_client as async_client_module
from taskforceai import (
    AsyncTaskForceAIClient,
    ImageAttachment,
    TaskForceAIClient,
    TaskForceAIError,
    ThreadRunOptions,
)
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
    assert client._request("PATCH", "/unknown") == {"status": "ok"}


def test_mock_thread_run_response() -> None:
    client = TaskForceAIClient(mock_mode=True)
    response = client.run_in_thread(1, ThreadRunOptions(prompt="Run the mock thread"))

    assert response.task_id == "mock-thread-task"
    assert response.status == "processing"
    client.close()
    client.close()


def test_sync_finalize_client_closes_client() -> None:
    class DummyClient:
        closed = False

        def close(self) -> None:
            self.closed = True

    client = DummyClient()
    TaskForceAIClient._finalize_client(client)  # type: ignore[arg-type]
    assert client.closed is True


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


def test_submit_task_uploads_images_and_sends_attachment_ids() -> None:
    seen_paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_paths.append(request.url.path)
        if request.url.path.endswith("/attachments/upload"):
            return httpx.Response(
                200,
                json={"id": "attachment-image-1", "mime_type": "image/png", "size": 5},
                request=request,
            )
        payload = json.loads(request.read().decode())
        assert payload["attachment_ids"] == ["attachment-image-1"]
        assert "attachments" not in payload
        return httpx.Response(
            200,
            json={"taskId": "task-images", "status": "processing"},
            request=request,
        )

    client = TaskForceAIClient("key", transport=httpx.MockTransport(handler))
    task_id = client.submit_task(
        "describe image",
        images=[ImageAttachment(data="aGVsbG8=", mime_type="image/png", name="image.png")],
    )

    assert task_id == "task-images"
    assert seen_paths == ["/api/v1/attachments/upload", "/api/v1/developer/run"]
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
async def test_async_submit_task_uploads_images_and_sends_attachment_ids() -> None:
    seen_paths: list[str] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        seen_paths.append(request.url.path)
        if request.url.path.endswith("/attachments/upload"):
            return httpx.Response(
                200,
                json={"id": "attachment-image-1", "mime_type": "image/png", "size": 5},
                request=request,
            )
        payload = json.loads((await request.aread()).decode())
        assert payload["attachment_ids"] == ["attachment-image-1"]
        assert "attachments" not in payload
        return httpx.Response(
            200,
            json={"taskId": "task-images", "status": "processing"},
            request=request,
        )

    async with AsyncTaskForceAIClient("key", transport=httpx.MockTransport(handler)) as client:
        task_id = await client.submit_task(
            "describe image",
            images=[ImageAttachment(data="aGVsbG8=", mime_type="image/png", name="image.png")],
        )

    assert task_id == "task-images"
    assert seen_paths == ["/api/v1/attachments/upload", "/api/v1/developer/run"]


@pytest.mark.asyncio
async def test_async_wait_for_completion_invokes_status_callback() -> None:
    seen: list[str] = []
    async with AsyncTaskForceAIClient(mock_mode=True) as client:
        task_id = await client.submit_task("mock")
        status = await client.wait_for_completion(
            task_id,
            poll_interval=0,
            on_status=lambda payload: seen.append(payload.status),
        )

    assert status.status == "completed"
    assert seen == ["processing", "completed"]


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


def test_async_finalize_client_ignores_closed_running_loop(monkeypatch: pytest.MonkeyPatch) -> None:
    class DummyClient:
        async def aclose(self) -> None:
            return

    class ClosedLoop:
        def is_closed(self) -> bool:
            return True

    monkeypatch.setattr(async_client_module.asyncio, "get_running_loop", lambda: ClosedLoop())
    AsyncTaskForceAIClient._finalize_client(DummyClient())  # type: ignore[arg-type]


def test_async_finalize_client_ignores_threadsafe_runtime_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class DummyClient:
        async def aclose(self) -> None:
            return

    class OpenLoop:
        def is_closed(self) -> bool:
            return False

    def raise_runtime_error(coro: object, loop: object) -> object:
        close = getattr(coro, "close", None)
        if close is not None:
            close()
        raise RuntimeError("loop stopped")

    monkeypatch.setattr(async_client_module.asyncio, "get_running_loop", lambda: OpenLoop())
    monkeypatch.setattr(
        async_client_module.asyncio,
        "run_coroutine_threadsafe",
        raise_runtime_error,
    )
    AsyncTaskForceAIClient._finalize_client(DummyClient())  # type: ignore[arg-type]
