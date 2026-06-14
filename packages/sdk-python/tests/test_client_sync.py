from __future__ import annotations

import json
from typing import Any, Dict, List

import httpx
import pytest

from client_helpers import build_transport
from taskforceai import (
    TaskAwaitingApproval,
    TaskForceAIClient,
    TaskForceAIError,
    TaskStatusResponse,
)


def test_submit_task_success() -> None:
    transport = build_transport(
        [
            {
                "status": 200,
                "json": {"taskId": "task_123", "status": "processing"},
                "path": "/api/v1/developer/run",
                "method": "POST",
            }
        ]
    )
    client = TaskForceAIClient(
        "test-key", base_url="https://example.com/api/v1/developer", transport=transport
    )

    task_id = client.submit_task("Run analysis")

    assert task_id == "task_123"
    client.close()


def test_submit_task_accepts_custom_options() -> None:
    captured_payload: Dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal captured_payload
        captured_payload = json.loads(request.content.decode())
        return httpx.Response(
            status_code=200,
            json={"taskId": "task_extra", "status": "processing"},
            request=request,
        )

    client = TaskForceAIClient(
        "key",
        base_url="https://example.com/api/v1/developer",
        transport=httpx.MockTransport(handler),
    )

    task_id = client.submit_task(
        "Check options",
        options={"silent": True, "budget": 8},
        mock=False,
    )

    assert task_id == "task_extra"
    assert captured_payload["options"] == {"silent": True, "mock": False, "budget": 8}
    client.close()


def test_submit_task_error() -> None:
    transport = build_transport(
        [
            {
                "status": 401,
                "json": {"error": "Invalid API key"},
                "path": "/api/v1/developer/run",
                "method": "POST",
            }
        ]
    )
    client = TaskForceAIClient(
        "bad-key", base_url="https://example.com/api/v1/developer", transport=transport
    )

    with pytest.raises(TaskForceAIError) as exc:
        client.submit_task("Do something")

    assert exc.value.status_code == 401
    assert "Invalid API key" in str(exc.value)
    client.close()


def test_submit_task_error_with_non_string_payload() -> None:
    transport = build_transport(
        [
            {
                "status": 400,
                "json": {"error": {"detail": "bad request"}},
                "path": "/api/v1/developer/run",
                "method": "POST",
            }
        ]
    )
    client = TaskForceAIClient(
        "bad-key", base_url="https://example.com/api/v1/developer", transport=transport
    )

    with pytest.raises(TaskForceAIError) as exc:
        client.submit_task("Do something")

    assert "{'detail': 'bad request'}" in str(exc.value)
    client.close()


def test_wait_for_completion_success() -> None:
    transport = build_transport(
        [
            {
                "status": 200,
                "json": {"taskId": "task_123", "status": "processing"},
                "path": "/api/v1/developer/status/task_123",
            },
            {
                "status": 200,
                "json": {"taskId": "task_123", "status": "completed", "result": "done"},
                "path": "/api/v1/developer/status/task_123",
            },
        ]
    )
    client = TaskForceAIClient(
        "key", base_url="https://example.com/api/v1/developer", transport=transport
    )

    statuses: List[TaskStatusResponse] = []
    result = client.wait_for_completion(
        "task_123",
        poll_interval=0.01,
        max_attempts=5,
        on_status=lambda payload: statuses.append(payload),
    )

    assert statuses[0].status == "processing"
    assert result.task_id == "task_123"
    assert result.result == "done"
    assert result.status == "completed"
    client.close()


def test_wait_for_completion_retries_transient_poll_error() -> None:
    attempts = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        assert request.url.path == "/api/v1/developer/status/task_retry"
        if attempts == 1:
            raise httpx.TransportError("temporary outage")
        if attempts == 2:
            return httpx.Response(
                status_code=200,
                json={"taskId": "task_retry", "status": "processing"},
                request=request,
            )
        return httpx.Response(
            status_code=200,
            json={"taskId": "task_retry", "status": "completed", "result": "done"},
            request=request,
        )

    client = TaskForceAIClient(
        "key",
        base_url="https://example.com/api/v1/developer",
        transport=httpx.MockTransport(handler),
    )

    result = client.wait_for_completion("task_retry", poll_interval=0.0, max_attempts=5)

    assert attempts == 3
    assert result.status == "completed"
    client.close()


def test_wait_for_completion_stops_after_repeated_poll_errors() -> None:
    attempts = 0

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        raise httpx.TransportError("still down")

    client = TaskForceAIClient("key", transport=httpx.MockTransport(handler))

    with pytest.raises(TaskForceAIError, match="3 consecutive attempts"):
        client.wait_for_completion("task_down", poll_interval=0.0, max_attempts=5)

    assert attempts == 3
    client.close()


def test_wait_for_completion_awaiting_approval() -> None:
    transport = build_transport(
        [
            {
                "status": 200,
                "json": {
                    "taskId": "task_approval",
                    "status": "awaiting_approval",
                    "message": "Approval required",
                },
                "path": "/api/v1/developer/status/task_approval",
            },
        ]
    )
    client = TaskForceAIClient(
        "key", base_url="https://example.com/api/v1/developer", transport=transport
    )

    with pytest.raises(TaskForceAIError, match="Approval required"):
        client.wait_for_completion("task_approval", poll_interval=0.0, max_attempts=1)

    client.close()


def test_run_task_failure() -> None:
    transport = build_transport(
        [
            {
                "status": 200,
                "json": {"taskId": "task_456", "status": "processing"},
                "path": "/api/v1/developer/run",
                "method": "POST",
            },
            {
                "status": 200,
                "json": {"taskId": "task_456", "status": "failed", "error": "Task failed"},
                "path": "/api/v1/developer/status/task_456",
                "method": "GET",
            },
        ]
    )
    client = TaskForceAIClient(
        "key", base_url="https://example.com/api/v1/developer", transport=transport
    )

    with pytest.raises(TaskForceAIError) as exc:
        client.run_task("Investigate bug", poll_interval=0.01, max_attempts=2)

    assert "Task failed" in str(exc.value)
    client.close()


def test_stream_task_status_emits_updates() -> None:
    transport = build_transport(
        [
            {
                "status": 200,
                "json": {"taskId": "task_stream", "status": "processing"},
                "path": "/api/v1/developer/status/task_stream",
            },
            {
                "status": 200,
                "json": {"taskId": "task_stream", "status": "completed", "result": "done"},
                "path": "/api/v1/developer/status/task_stream",
            },
        ]
    )
    client = TaskForceAIClient(
        "key", base_url="https://example.com/api/v1/developer", transport=transport
    )

    stream = client.stream_task_status("task_stream", poll_interval=0.0, max_attempts=2)
    statuses = list(stream)

    assert statuses[-1].status == "completed"
    client.close()


def test_stream_task_status_stops_on_awaiting_approval() -> None:
    transport = build_transport(
        [
            {
                "status": 200,
                "json": {"taskId": "task_stream", "status": "processing"},
                "path": "/api/v1/developer/status/task_stream",
            },
            {
                "status": 200,
                "json": {
                    "taskId": "task_stream",
                    "status": "awaiting_approval",
                    "message": "Approval required",
                },
                "path": "/api/v1/developer/status/task_stream",
            },
        ]
    )
    client = TaskForceAIClient(
        "key", base_url="https://example.com/api/v1/developer", transport=transport
    )

    statuses = list(client.stream_task_status("task_stream", poll_interval=0.0, max_attempts=3))

    assert statuses[-1].status == "awaiting_approval"
    assert isinstance(statuses[-1], TaskAwaitingApproval)
    client.close()


def test_stream_task_status_cancel() -> None:
    transport = build_transport(
        [
            {
                "status": 200,
                "json": {"taskId": "task_cancel", "status": "processing"},
                "path": "/api/v1/developer/status/task_cancel",
            }
        ]
    )
    client = TaskForceAIClient(
        "key", base_url="https://example.com/api/v1/developer", transport=transport
    )

    stream = client.stream_task_status("task_cancel", poll_interval=0.0, max_attempts=2)
    first = next(stream)
    assert first.status == "processing"
    stream.cancel()
    with pytest.raises(TaskForceAIError, match="cancelled"):
        next(stream)
    client.close()


def test_stream_task_status_max_attempts_error() -> None:
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
    client = TaskForceAIClient(
        "key", base_url="https://example.com/api/v1/developer", transport=transport
    )

    stream = client.stream_task_status("task_timeout", poll_interval=0.0, max_attempts=2)
    statuses: List[TaskStatusResponse] = []

    with pytest.raises(TaskForceAIError, match="expected time"):
        for status in stream:
            statuses.append(status)

    assert len(statuses) == 2
    client.close()


def test_stream_task_status_parse_error_propagates() -> None:
    transport = build_transport(
        [
            {
                "status": 200,
                "json": {"unexpected": "payload"},
                "path": "/api/v1/developer/status/task_parse",
            }
        ]
    )
    client = TaskForceAIClient(
        "key", base_url="https://example.com/api/v1/developer", transport=transport
    )

    stream = client.stream_task_status("task_parse", poll_interval=0.0, max_attempts=1)

    with pytest.raises(TaskForceAIError, match="Invalid API response"):
        next(stream)

    client.close()


def test_client_validates_api_key() -> None:
    with pytest.raises(TaskForceAIError):
        TaskForceAIClient("  ")


def test_client_context_manager_closes_client() -> None:
    captured: TaskForceAIClient | None = None
    with TaskForceAIClient("key") as client:
        captured = client
        assert not client._client.is_closed

    assert captured is not None
    assert captured._client.is_closed


def test_client_request_timeout() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        raise httpx.TimeoutException("timeout")

    client = TaskForceAIClient("key", transport=httpx.MockTransport(handler))

    with pytest.raises(TaskForceAIError, match="Request timeout"):
        client.get_task_status("task")

    client.close()


def test_client_http_status_error_with_text() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, text="Service unavailable", request=request)

    client = TaskForceAIClient("key", transport=httpx.MockTransport(handler))

    with pytest.raises(TaskForceAIError) as exc:
        client.get_task_status("task")

    assert exc.value.status_code == 503
    assert "Service unavailable" in str(exc.value)
    client.close()


def test_client_network_error() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        raise httpx.TransportError("boom")

    client = TaskForceAIClient("key", transport=httpx.MockTransport(handler))

    with pytest.raises(TaskForceAIError, match="Network error: boom"):
        client.get_task_status("task")

    client.close()


def test_response_hook_receives_headers() -> None:
    captured: List[httpx.Headers] = []

    def hook(response: httpx.Response) -> None:
        captured.append(response.headers)

    transport = build_transport(
        [
            {
                "status": 200,
                "json": {"taskId": "task_meta", "status": "completed", "result": "ok"},
                "path": "/api/v1/developer/status/task_meta",
            }
        ]
    )

    client = TaskForceAIClient(
        "key",
        base_url="https://example.com/api/v1/developer",
        transport=transport,
        response_hook=hook,
    )

    status = client.get_task_status("task_meta")
    assert status.result == "ok"
    assert captured
    client.close()


def test_submit_task_validates_prompt() -> None:
    client = TaskForceAIClient("key")
    with pytest.raises(TaskForceAIError, match="Prompt must be a non-empty string"):
        client.submit_task("   ")
    client.close()


def test_submit_task_missing_task_id() -> None:
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
    client = TaskForceAIClient(
        "key", base_url="https://example.com/api/v1/developer", transport=transport
    )

    with pytest.raises(TaskForceAIError, match="Invalid API response"):
        client.submit_task("Prompt")
    client.close()


def test_get_task_result_validates_input() -> None:
    client = TaskForceAIClient("key")
    with pytest.raises(TaskForceAIError, match="Task ID must be a non-empty string"):
        client.get_task_result("")
    client.close()


def test_get_task_status_validates_input() -> None:
    client = TaskForceAIClient("key")
    with pytest.raises(TaskForceAIError, match="Task ID must be a non-empty string"):
        client.get_task_status(" ")
    client.close()


def test_task_id_path_segments_are_escaped() -> None:
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(
            200,
            json={"taskId": "team/one task?", "status": "completed", "result": "done"},
            request=request,
        )

    client = TaskForceAIClient(
        "key",
        base_url="https://example.com/api/v1/developer",
        transport=httpx.MockTransport(handler),
    )

    client.get_task_status("team/one task?")
    client.get_task_result("team/one task?")

    assert captured[0].url.raw_path == b"/api/v1/developer/status/team%2Fone%20task%3F"
    assert captured[1].url.raw_path == b"/api/v1/developer/results/team%2Fone%20task%3F"
    client.close()


def test_get_task_result_success() -> None:
    transport = build_transport(
        [
            {
                "status": 200,
                "json": {"taskId": "task_1", "status": "completed", "result": "done"},
                "path": "/api/v1/developer/results/task_1",
                "method": "GET",
            }
        ]
    )
    client = TaskForceAIClient(
        "key", base_url="https://example.com/api/v1/developer", transport=transport
    )

    result = client.get_task_result("task_1")

    assert result.result == "done"
    assert result.status == "completed"
    client.close()


def test_wait_for_completion_timeout() -> None:
    transport = build_transport(
        [
            {
                "status": 200,
                "json": {"taskId": "task_1", "status": "processing"},
                "path": "/api/v1/developer/status/task_1",
            },
            {
                "status": 200,
                "json": {"taskId": "task_1", "status": "processing"},
                "path": "/api/v1/developer/status/task_1",
            },
        ]
    )
    client = TaskForceAIClient(
        "key", base_url="https://example.com/api/v1/developer", transport=transport
    )

    with pytest.raises(TaskForceAIError, match="expected time"):
        client.wait_for_completion("task_1", poll_interval=0.0, max_attempts=2)
    client.close()


def test_taskforceai_error_repr() -> None:
    err = TaskForceAIError("oops", status_code=400)
    assert repr(err) == "TaskForceAIError('oops', status_code=400)"
