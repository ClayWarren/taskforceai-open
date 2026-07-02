# TaskForceAI Go SDK

Official Go SDK for the TaskForceAI multi-agent orchestration API.

## Installation

```bash
go get github.com/ClayWarren/taskforceai-open/packages/sdk-go
```

## Quick Start

```go
package main

import (
	"context"
	"fmt"
	"log"

	"github.com/ClayWarren/taskforceai-open/packages/sdk-go"
)

func main() {
	client, err := taskforceai.NewClient(taskforceai.TaskForceAIOptions{
		APIKey: "your-api-key-here",
	})
	if err != nil {
		log.Fatal(err)
	}

	// Run a task and wait for completion
	status, err := client.RunTask(context.Background(), "Explain quantum computing", nil, 0, 0, nil)
	if err != nil {
		log.Fatal(err)
	}

	if status.Result != nil {
		fmt.Printf("Result: %s\n", *status.Result)
	}
}
```

## API Reference

### Client

The main entry point for the SDK.

#### `NewClient(opts TaskForceAIOptions) (*Client, error)`

Creates a new TaskForceAI client. It returns an error when required configuration is invalid, such as a missing API key outside mock mode.

**Options:**

- `APIKey`: Your API key (required unless in MockMode)
- `BaseURL`: Custom API endpoint (default: https://taskforceai.chat/api/v1/developer)
- `Timeout`: Request timeout (default: 30s)
- `MockMode`: Enable local mocking without network calls

### Methods

#### `SubmitTask(ctx, prompt, opts) (string, error)`

Submits a prompt and returns a Task ID.

#### `GetTaskStatus(ctx, taskID) (TaskStatus, error)`

Retrieves the current status of a specific task.

#### `WaitForCompletion(ctx, taskID, interval, maxAttempts, callback) (TaskStatus, error)`

Polls the task status until it reaches a terminal state (`completed` or `failed`).

#### `RunTask(ctx, prompt, opts, interval, maxAttempts, callback) (TaskStatus, error)`

Convenience method that combines `SubmitTask` and `WaitForCompletion`.

#### `StreamTaskStatus(ctx, taskID) (TaskStatusStream, error)`

Opens an SSE stream to receive real-time status updates for a task.

#### `RunTaskStream(ctx, prompt, opts) (TaskStatusStream, error)`

Convenience method that submits a task and immediately opens an SSE stream.

## Streaming Usage

```go
stream, err := client.RunTaskStream(context.Background(), "Summarize this article...", nil)
if err != nil {
    log.Fatal(err)
}
defer stream.Close()

for {
    status, err := stream.Next()
    if err != nil {
        if err == io.EOF {
            break
        }
        log.Fatal(err)
    }
    fmt.Printf("Status: %s\n", status.Status)
}
```

## Files

Upload, list, inspect, delete, and download files for Developer API workflows:

```go
uploaded, err := client.UploadFile(
	context.Background(),
	"brief.txt",
	strings.NewReader("Context for the run"),
	&taskforceai.FileUploadOptions{
		Purpose:  "assistants",
		MimeType: "text/plain",
	},
)
if err != nil {
	log.Fatal(err)
}

files, err := client.ListFiles(context.Background(), 20, 0)
metadata, err := client.GetFile(context.Background(), uploaded.ID)
content, err := client.DownloadFile(context.Background(), uploaded.ID)
err = client.DeleteFile(context.Background(), uploaded.ID)
```

## Threads

Create persistent conversation threads and run prompts inside existing thread context:

```go
thread, err := client.CreateThread(context.Background(), &taskforceai.CreateThreadOptions{
	Title: "Security review",
})
if err != nil {
	log.Fatal(err)
}

run, err := client.RunInThread(context.Background(), thread.ID, taskforceai.ThreadRunOptions{
	Prompt:  "Review the uploaded brief.",
	ModelID: "zai/glm-5.2",
	Options: map[string]any{
		"agentCount": 4,
	},
})

threads, err := client.ListThreads(context.Background(), 20, 0)
messages, err := client.GetThreadMessages(context.Background(), thread.ID, 50, 0)
```

`DeleteThread` intentionally returns an error because the current Developer API does not expose a thread delete endpoint.

## License

MIT
