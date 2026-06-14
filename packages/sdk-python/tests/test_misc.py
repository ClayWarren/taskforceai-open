import httpx
import pytest

from taskforceai import AsyncTaskForceAIClient, TaskForceAIClient, TaskForceAIError
from taskforceai.files import FileUploadOptions
from taskforceai.utils import extract_error_message, validate_task_status


def test_mock_mode_sync() -> None:
    client = TaskForceAIClient(mock_mode=True)

    # Submit task
    task_id = client.submit_task("Mock task")
    assert task_id.startswith("mock-")

    # Get status (first call processing, second completed)
    status = client.get_task_status(task_id)
    assert status.status == "processing"

    status = client.get_task_status(task_id)
    assert status.status == "completed"

    # Get results
    res = client.get_task_result(task_id)
    assert res.status == "completed"

    # List threads / files
    assert len(client.list_threads().threads) == 0
    thread = client.get_thread(42)
    assert thread.id == 1
    assert thread.title == "Mock"
    assert len(client.get_thread_messages(42).messages) == 0
    assert len(client.list_files().files) == 0

    # Upload/Download
    file = client.upload_file("test.txt", b"content", FileUploadOptions(purpose="demo"))
    assert file.id == "mock-file-id"
    assert file.filename == "test.txt"
    assert file.purpose == "demo"
    assert file.bytes == 0
    assert client.download_file(file.id) == b"mock file content"

    client.close()


@pytest.mark.asyncio
async def test_mock_mode_async() -> None:
    async with AsyncTaskForceAIClient(mock_mode=True) as client:
        task_id = await client.submit_task("Mock")
        assert task_id.startswith("mock-")

        status = await client.get_task_status(task_id)
        assert status.status == "processing"

        status = await client.get_task_status(task_id)
        assert status.status == "completed"

        assert len((await client.list_threads()).threads) == 0
        thread = await client.get_thread(42)
        assert thread.id == 1
        assert thread.title == "Mock"
        assert len((await client.get_thread_messages(42)).messages) == 0
        assert len((await client.list_files()).files) == 0
        assert await client.download_file("file-id") == b"mock file content"


def test_extract_error_message_list() -> None:
    class MockResponse:
        def __init__(self, json_data):
            self._json = json_data

        def json(self):
            return self._json

    # Test path where error is a list
    resp = MockResponse({"error": ["First error", "Second error"]})
    assert extract_error_message(resp) == "['First error', 'Second error']"


def test_extract_error_message_invalid_json_body() -> None:
    request = httpx.Request("GET", "https://example.com/fail")
    response = httpx.Response(
        status_code=500,
        text="upstream html error",
        request=request,
        headers={"content-type": "text/html"},
    )
    message = extract_error_message(response)
    assert "response was not valid JSON" in message
    assert "upstream html error" in message


def test_validate_task_status_missing_id() -> None:
    with pytest.raises(TaskForceAIError, match="Invalid API response"):
        validate_task_status({"status": "ok"})  # Missing taskId


def test_sync_client_response_hook() -> None:
    captured = []

    def hook(resp):
        captured.append(resp)

    client = TaskForceAIClient(mock_mode=True, response_hook=hook)
    # Even in mock mode, it shouldn't call it if it doesn't make a real request
    # But let's check sync_client.py:114 calls _mock_response
    # Request hook is in _request (line 125) which is bypassed in mock mode.
    # So to test response hook we need a real-ish request (mock transport)
    client.close()


def test_sync_client_response_hook_real() -> None:
    captured = []

    def hook(resp):
        captured.append(resp)

    def handler(request):
        return httpx.Response(200, json={"taskId": "t-1", "status": "processing"})

    client = TaskForceAIClient("key", transport=httpx.MockTransport(handler), response_hook=hook)
    client.get_task_status("t-1")
    assert len(captured) == 1
    client.close()


def test_sync_client_validations() -> None:
    client = TaskForceAIClient(mock_mode=True)
    from taskforceai import ThreadRunOptions

    with pytest.raises(TaskForceAIError, match="Prompt must be a non-empty string"):
        client.run_in_thread(1, ThreadRunOptions(prompt="  "))
    with pytest.raises(TaskForceAIError, match="Task ID must be a non-empty string"):
        client.stream_task_status("  ")
    client.close()


def test_sync_run_task_stream() -> None:
    client = TaskForceAIClient(mock_mode=True)
    stream = client.run_task_stream("hi", poll_interval=0)
    res = list(stream)
    assert res[-1].status == "completed"
    client.close()


def test_sync_upload_file_error() -> None:
    def handler(request):
        return httpx.Response(400, json={"error": "bad"})

    client = TaskForceAIClient("key", transport=httpx.MockTransport(handler))
    with pytest.raises(TaskForceAIError, match="bad"):
        client.upload_file("t.txt", b"c")
    client.close()


def test_sync_download_file_error() -> None:
    def handler(request):
        return httpx.Response(500, text="fatal")

    client = TaskForceAIClient("key", transport=httpx.MockTransport(handler))
    with pytest.raises(TaskForceAIError, match="fatal"):
        client.download_file("f-1")
    client.close()
