from __future__ import annotations

from typing import Any, Dict, List

import httpx


def build_transport(responses: List[Dict[str, Any]]) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if not responses:
            raise AssertionError("Unexpected request: no mock responses left")
        spec = responses.pop(0)
        status = spec.get("status", 200)
        json_data = spec.get("json")
        text_data = spec.get("text")
        headers = spec.get("headers")
        method = spec.get("method")
        if method:
            assert request.method == method
        path = spec.get("path")
        if path:
            assert request.url.path == path

        if json_data is not None:
            return httpx.Response(
                status_code=status,
                json=json_data,
                headers=headers,
                request=request,
            )

        return httpx.Response(
            status_code=status,
            text=text_data or "",
            headers=headers,
            request=request,
        )

    return httpx.MockTransport(handler)
