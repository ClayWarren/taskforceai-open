# TaskForceAI Python SDK

The official Python client for TaskForceAI's multi-agent orchestration platform.

- ✅ Sync + async clients powered by `httpx`
- ✅ Automatic authentication with your TaskForceAI API key
- ✅ Convenience helpers for polling task completion
- ✅ Rich error handling with status codes and retry-ready exceptions
- ✅ Mock mode for development without an API key

## Installation

```bash
python -m pip install taskforceai
```

## Quick Start

```python
from taskforceai import TaskForceAIClient

client = TaskForceAIClient(api_key="your-api-key")

task_id = client.submit_task("Analyze the security posture of this repository.")
status = client.wait_for_completion(task_id)

print(status.result)
```

```python

# Forward arbitrary TaskForceAI orchestration options
task_id = client.submit_task(
    "Do a full repository risk review",
    options={"agentCount": 4, "budget": 12},
)
```

### Mock Mode

Build and test your integration without an API key using mock mode:

```python
from taskforceai import TaskForceAIClient

# No API key required in mock mode
client = TaskForceAIClient(mock_mode=True)

result = client.run_task("Test your integration")
print(result.result)  # "This is a mock response. Configure your API key to get real results."
```

Mock mode simulates the full task lifecycle locally—no network requests are made. Tasks go through "processing" then "completed" states, making it easy to build UIs and test error handling before launch.

### Async Variant

```python
import asyncio
from taskforceai import AsyncTaskForceAIClient

async def main() -> None:
    async with AsyncTaskForceAIClient(api_key="your-api-key") as client:
        result = await client.run_task("Summarize the latest launch notes.")
        print(result.result)

asyncio.run(main())
```

### Streaming Task Updates

```python
from taskforceai import TaskForceAIClient

client = TaskForceAIClient(api_key="your-api-key")
stream = client.run_task_stream("Map open security issues", poll_interval=0.5)

for status in stream:
    print(f"{status.status}: {getattr(status, 'result', None)}")

# Cancel locally if needed
# stream.cancel()
```

Async projects can use `AsyncTaskForceAIClient.stream_task_status()` and iterate with
`async for status in stream` for non-blocking workflows.

## API Surface

Both clients expose the same methods:

- `submit_task(prompt, *, options=None, silent=None, mock=None) -> str`
- `get_task_status(task_id) -> TaskStatusResponse`
- `get_task_result(task_id) -> TaskStatusResponse`
- `wait_for_completion(task_id, poll_interval=2.0, max_attempts=150, on_status=None) -> TaskStatusResponse`
- `run_task(prompt, ..., on_status=None) -> TaskStatusResponse`
- `stream_task_status(task_id, ..., on_status=None) -> Iterator`
- `run_task_stream(prompt, ..., on_status=None) -> Iterator`

### Files

Upload, list, inspect, delete, and download files for Developer API workflows:

```python
from taskforceai import FileUploadOptions

uploaded = client.upload_file(
    "brief.txt",
    b"Context for the run",
    FileUploadOptions(purpose="assistants", mime_type="text/plain"),
)

files = client.list_files(limit=20, offset=0)
metadata = client.get_file(uploaded.id)
content = client.download_file(uploaded.id)
client.delete_file(uploaded.id)
```

For task-scoped images, use transient attachments rather than the persistent files API:

```python
attachment_id = client.upload_attachment(
    "diagram.png",
    image_bytes,
    mime_type="image/png",
)

task_id = client.submit_task(
    "Analyze this diagram",
    attachment_ids=[attachment_id],
)
```

### Threads

Create persistent conversation threads and run prompts inside existing thread context:

```python
from taskforceai import CreateThreadOptions, ThreadRunOptions

thread = client.create_thread(CreateThreadOptions(title="Security review"))
run = client.run_in_thread(
    thread.id,
    ThreadRunOptions(
        prompt="Review the uploaded brief.",
        model_id="zai/glm-5.2",
        stream=False,
    ),
)

conversations = client.list_threads(limit=20, offset=0).conversations
messages = client.get_thread_messages(thread.id, limit=50, offset=0)
```

`delete_thread()` intentionally raises `TaskForceAIError` because the current Developer API does not expose a thread delete endpoint.

### Response Hooks & Rate-Limit Telemetry

Both clients accept `response_hook=` in their constructors. The hook is invoked with the
raw `httpx.Response` (headers included) for every request, making it easy to track
rate-limit headers, request IDs, or emit custom metrics without wrapping the SDK.

All responses mirror the REST API payloads. Errors raise `TaskForceAIError`, which includes `status_code` for quick branching.

## Development

```bash
python -m pip install -e "packages/sdk/python[dev]"
pytest packages/sdk/python/tests
ruff format packages/sdk/python/src packages/sdk/python/tests -q
ruff check packages/sdk/python/src packages/sdk/python/tests
mypy --config-file packages/sdk/python/pyproject.toml packages/sdk/python/src
```

## License

MIT
