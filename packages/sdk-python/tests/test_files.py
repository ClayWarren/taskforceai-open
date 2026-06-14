from typing import Any, Dict, List

import httpx
import pytest

from taskforceai import TaskForceAIClient, TaskForceAIError
from taskforceai.files import FileUploadOptions


def build_transport(responses: List[Dict[str, Any]]) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if not responses:
            raise AssertionError("Unexpected request: no mock responses left")
        spec = responses.pop(0)
        status = spec.get("status", 200)
        json_data = spec.get("json")
        text_data = spec.get("text")

        if "path" in spec:
            assert request.url.path == spec["path"]
        if "method" in spec:
            assert request.method == spec["method"]

        if json_data is not None:
            return httpx.Response(status_code=status, json=json_data, request=request)
        return httpx.Response(status_code=status, text=text_data or "", request=request)

    return httpx.MockTransport(handler)


def test_upload_file() -> None:
    captured_requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured_requests.append(request)
        return httpx.Response(
            status_code=200,
            json={
                "id": "file-123",
                "filename": "test.txt",
                "purpose": "test",
                "bytes": 100,
                "created_at": "2023-01-01T00:00:00Z",
            },
            request=request,
        )

    transport = httpx.MockTransport(handler)
    client = TaskForceAIClient("key", transport=transport)

    file = client.upload_file(
        "test.txt",
        b"content",
        FileUploadOptions(purpose="test", mime_type="text/plain"),
    )
    assert file.id == "file-123"
    assert file.filename == "test.txt"
    assert file.purpose == "test"

    request = captured_requests[0]
    assert request.url.path == "/api/v1/developer/files"
    assert request.method == "POST"
    assert request.headers["x-api-key"] == "key"
    assert request.headers["x-sdk-language"] == "python"
    assert "content-type" in request.headers
    body = request.content
    assert b'name="purpose"' in body
    assert b"test" in body
    assert b'name="mime_type"' in body
    assert b"text/plain" in body
    assert b'name="file"; filename="test.txt"' in body
    assert b"content" in body
    client.close()


def test_upload_file_without_options_sends_no_metadata_fields() -> None:
    captured_requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured_requests.append(request)
        return httpx.Response(
            status_code=200,
            json={
                "id": "file-124",
                "filename": "empty.txt",
                "purpose": "general",
                "bytes": 0,
                "created_at": "2023-01-01T00:00:00Z",
            },
            request=request,
        )

    client = TaskForceAIClient("key", transport=httpx.MockTransport(handler))

    file = client.upload_file("empty.txt", b"")
    assert file.id == "file-124"
    body = captured_requests[0].content
    assert b'name="purpose"' not in body
    assert b'name="mime_type"' not in body
    assert b'name="file"; filename="empty.txt"' in body
    client.close()


def test_upload_file_response_hook_and_http_error() -> None:
    captured_statuses: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(413, json={"error": "File too large"}, request=request)

    client = TaskForceAIClient(
        "key",
        transport=httpx.MockTransport(handler),
        response_hook=lambda response: captured_statuses.append(response.status_code),
    )

    with pytest.raises(TaskForceAIError) as exc:
        client.upload_file("large.bin", b"x")

    assert exc.value.status_code == 413
    assert "File too large" in str(exc.value)
    assert captured_statuses == [413]
    client.close()


def test_upload_file_network_error() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        raise httpx.TransportError("offline")

    client = TaskForceAIClient("key", transport=httpx.MockTransport(handler))

    with pytest.raises(TaskForceAIError, match="Network error: offline"):
        client.upload_file("test.txt", b"content")

    client.close()


def test_upload_file_legacy_response_shape() -> None:
    transport = build_transport(
        [
            {
                "status": 200,
                "json": {
                    "id": "file-123",
                    "filename": "test.txt",
                    "purpose": "test",
                    "bytes": 100,
                    "created_at": "2023-01-01T00:00:00Z",
                },
                "path": "/api/v1/developer/files",
                "method": "POST",
            }
        ]
    )
    client = TaskForceAIClient("key", transport=transport)

    file = client.upload_file("test.txt", b"content")
    assert file.id == "file-123"
    assert file.filename == "test.txt"
    client.close()


def test_list_files() -> None:
    transport = build_transport(
        [
            {
                "status": 200,
                "json": {
                    "files": [
                        {
                            "id": "file-1",
                            "filename": "f1",
                            "purpose": "p",
                            "bytes": 10,
                            "created_at": "2023-01-01T00:00:00Z",
                        }
                    ],
                    "total": 1,
                },
                "path": "/api/v1/developer/files",
                "method": "GET",
            }
        ]
    )
    client = TaskForceAIClient("key", transport=transport)

    res = client.list_files()
    assert len(res.files) == 1
    assert res.total == 1
    client.close()


def test_get_file() -> None:
    transport = build_transport(
        [
            {
                "status": 200,
                "json": {
                    "id": "file-1",
                    "filename": "f1",
                    "purpose": "p",
                    "bytes": 10,
                    "created_at": "2023-01-01T00:00:00Z",
                },
                "path": "/api/v1/developer/files/file-1",
                "method": "GET",
            }
        ]
    )
    client = TaskForceAIClient("key", transport=transport)

    file = client.get_file("file-1")
    assert file.id == "file-1"
    client.close()


def test_list_files_rejects_unsafe_pagination_values() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        raise AssertionError("Unexpected request")

    client = TaskForceAIClient("key", transport=httpx.MockTransport(handler))

    with pytest.raises(TaskForceAIError, match="Limit must be an integer"):
        client.list_files(limit="20&offset=999")  # type: ignore[arg-type]
    with pytest.raises(TaskForceAIError, match="Offset must be non-negative"):
        client.list_files(offset=-1)

    assert requests == []
    client.close()


def test_delete_file() -> None:
    transport = build_transport(
        [{"status": 200, "json": {}, "path": "/api/v1/developer/files/file-1", "method": "DELETE"}]
    )
    client = TaskForceAIClient("key", transport=transport)

    client.delete_file("file-1")
    client.close()


def test_download_file() -> None:
    captured_requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured_requests.append(request)
        return httpx.Response(status_code=200, text="file content", request=request)

    client = TaskForceAIClient("key", transport=httpx.MockTransport(handler))

    content = client.download_file("file-1")
    assert content == b"file content"
    assert captured_requests[0].headers["x-api-key"] == "key"
    assert captured_requests[0].headers["x-sdk-language"] == "python"
    client.close()


def test_download_file_response_hook_and_http_error() -> None:
    captured_statuses: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"error": "Missing file"}, request=request)

    client = TaskForceAIClient(
        "key",
        transport=httpx.MockTransport(handler),
        response_hook=lambda response: captured_statuses.append(response.status_code),
    )

    with pytest.raises(TaskForceAIError) as exc:
        client.download_file("missing")

    assert exc.value.status_code == 404
    assert "Missing file" in str(exc.value)
    assert captured_statuses == [404]
    client.close()


def test_download_file_network_error() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        raise httpx.TransportError("connection reset")

    client = TaskForceAIClient("key", transport=httpx.MockTransport(handler))

    with pytest.raises(TaskForceAIError, match="Network error: connection reset"):
        client.download_file("file-1")

    client.close()


def test_file_id_path_segments_are_escaped() -> None:
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

    client = TaskForceAIClient(
        "key",
        base_url="https://example.com/api/v1/developer",
        transport=httpx.MockTransport(handler),
    )

    client.get_file("file/team one?")
    client.delete_file("file/team one?")
    client.download_file("file/team one?")

    assert captured[0].url.raw_path == b"/api/v1/developer/files/file%2Fteam%20one%3F"
    assert captured[1].url.raw_path == b"/api/v1/developer/files/file%2Fteam%20one%3F"
    assert captured[2].url.raw_path == b"/api/v1/developer/files/file%2Fteam%20one%3F/content"
    client.close()
