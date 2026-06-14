from typing import Any, Dict, List

import httpx
import pytest

from taskforceai import (
    CreateThreadOptions,
    TaskForceAIClient,
    TaskForceAIError,
    ThreadRunOptions,
)


def build_transport(responses: List[Dict[str, Any]]) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if not responses:
            raise AssertionError("Unexpected request")
        spec = responses.pop(0)
        status = spec.get("status", 200)
        json_data = spec.get("json")

        if "path" in spec:
            assert request.url.path == spec["path"]
        if "method" in spec:
            assert request.method == spec["method"]

        return httpx.Response(status_code=status, json=json_data, request=request)

    return httpx.MockTransport(handler)


def test_create_thread() -> None:
    transport = build_transport(
        [
            {
                "status": 200,
                "json": {
                    "id": 1,
                    "title": "My Thread",
                    "created_at": "2023-01-01T00:00:00Z",
                    "updated_at": "2023-01-01T00:00:00Z",
                },
                "path": "/api/v1/developer/threads",
                "method": "POST",
            }
        ]
    )
    client = TaskForceAIClient("key", transport=transport)

    thread = client.create_thread(CreateThreadOptions(title="My Thread"))
    assert thread.id == 1
    assert thread.title == "My Thread"
    client.close()


def test_list_threads() -> None:
    transport = build_transport(
        [
            {
                "status": 200,
                "json": {
                    "threads": [
                        {
                            "id": 1,
                            "title": "t1",
                            "created_at": "2023-01-01T00:00:00Z",
                            "updated_at": "2023-01-01T00:00:00Z",
                        }
                    ],
                    "total": 1,
                },
                "path": "/api/v1/developer/threads",
                "method": "GET",
            }
        ]
    )
    client = TaskForceAIClient("key", transport=transport)

    res = client.list_threads()
    assert len(res.threads) == 1
    client.close()


def test_list_threads_rejects_unsafe_pagination_values() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        raise AssertionError("Unexpected request")

    client = TaskForceAIClient("key", transport=httpx.MockTransport(handler))

    with pytest.raises(TaskForceAIError, match="Limit must be an integer"):
        client.list_threads(limit="20&offset=999")  # type: ignore[arg-type]
    with pytest.raises(TaskForceAIError, match="Offset must be non-negative"):
        client.list_threads(offset=-1)

    assert requests == []
    client.close()


def test_list_threads_preserves_valid_query_values() -> None:
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json={"threads": [], "total": 0}, request=request)

    client = TaskForceAIClient("key", transport=httpx.MockTransport(handler))

    res = client.list_threads(limit=25, offset=50)

    assert res.total == 0
    assert captured[0].url.raw_path == b"/api/v1/developer/threads?limit=25&offset=50"
    client.close()


def test_get_thread() -> None:
    transport = build_transport(
        [
            {
                "status": 200,
                "json": {
                    "id": 1,
                    "title": "t1",
                    "created_at": "2023-01-01T00:00:00Z",
                    "updated_at": "2023-01-01T00:00:00Z",
                },
                "path": "/api/v1/developer/threads/1",
                "method": "GET",
            }
        ]
    )
    client = TaskForceAIClient("key", transport=transport)

    thread = client.get_thread(1)
    assert thread.id == 1
    client.close()


def test_thread_id_rejects_unsafe_path_values() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        raise AssertionError("Unexpected request")

    client = TaskForceAIClient("key", transport=httpx.MockTransport(handler))

    with pytest.raises(TaskForceAIError, match="Thread ID must be an integer"):
        client.get_thread("1/messages")  # type: ignore[arg-type]
    with pytest.raises(TaskForceAIError, match="Thread ID must be greater than zero"):
        client.get_thread(0)
    with pytest.raises(TaskForceAIError, match="Thread ID must be an integer"):
        client.get_thread_messages("1/runs")  # type: ignore[arg-type]
    with pytest.raises(TaskForceAIError, match="Thread ID must be an integer"):
        client.run_in_thread("1/messages", ThreadRunOptions(prompt="run"))  # type: ignore[arg-type]

    assert requests == []
    client.close()


def test_delete_thread() -> None:
    transport = build_transport([])
    client = TaskForceAIClient("key", transport=transport)

    try:
        client.delete_thread(1)
        raise AssertionError("expected delete_thread to raise")
    except TaskForceAIError as exc:
        assert "not supported" in str(exc)
    client.close()


def test_get_thread_messages() -> None:
    transport = build_transport(
        [
            {
                "status": 200,
                "json": {
                    "messages": [
                        {
                            "id": 100,
                            "thread_id": 1,
                            "role": "user",
                            "content": "hi",
                            "created_at": "2023-01-01T00:00:00Z",
                        }
                    ],
                    "total": 1,
                },
                "path": "/api/v1/developer/threads/1/messages",
                "method": "GET",
            }
        ]
    )
    client = TaskForceAIClient("key", transport=transport)

    res = client.get_thread_messages(1)
    assert len(res.messages) == 1
    client.close()


def test_run_in_thread() -> None:
    transport = build_transport(
        [
            {
                "status": 200,
                "json": {
                    "taskId": "task-t1",
                    "threadId": 1,
                    "messageId": 101,
                    "task_id": "task-t1",
                    "thread_id": 1,
                    "message_id": 101,
                },
                "path": "/api/v1/developer/threads/1/runs",
                "method": "POST",
            }
        ]
    )
    client = TaskForceAIClient("key", transport=transport)

    res = client.run_in_thread(1, ThreadRunOptions(prompt="run"))
    assert res.task_id == "task-t1"
    client.close()
