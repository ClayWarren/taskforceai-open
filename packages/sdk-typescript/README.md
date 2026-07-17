# TaskForceAI SDK

Official SDK for the TaskForceAI multi-agent orchestration API.

## Installation

```bash
bun add taskforceai-sdk
```

> **Runtime Requirements:** Node.js 24.13.0 or newer, matching the package's declared engine support.

## Quick Start

```typescript
import { TaskForceAI } from 'taskforceai-sdk';

const client = new TaskForceAI({
  apiKey: 'your-api-key-here',
});

// Submit a task (using default free model)
const taskId = await client.submitTask('Test prompt');

// Wait for completion
const result = await client.waitForCompletion(taskId);
// handle result.result here

// Or stream status updates
const stream = client.streamTaskStatus(taskId);
for await (const status of stream) {
  // handle incremental status updates
}
```

## Mock Mode

Build and test your integration without an API key using mock mode:

```typescript
import { TaskForceAI } from 'taskforceai-sdk';

// No API key required in mock mode
const client = new TaskForceAI({ mockMode: true });

const result = await client.runTask('Test your integration');
console.log(result.result); // "This is a mock response. Configure your API key to get real results."
```

Mock mode simulates the full task lifecycle locally—no network requests are made. Tasks go through "processing" then "completed" states, making it easy to build UIs and test error handling before launch.

## API Reference

### TaskForceAI

Main SDK class for interacting with the TaskForceAI API.

#### Constructor

```typescript
constructor(options: TaskForceAIOptions)
```

**Options:**

- `apiKey` (required unless `mockMode` is true): Your API key
- `baseUrl` (optional): API base URL (default: https://taskforceai.chat/api/v1/developer)
- `timeout` (optional): Request timeout in milliseconds (default: 30000)
- `responseHook` (optional): Callback invoked with every raw `fetch` response
- `mockMode` (optional): Enable mock mode for development without an API key (default: false)

#### Methods

##### `submitTask(prompt, options?)`

Submit a task for multi-agent orchestration.

```typescript
async submitTask(
  prompt: string,
  options?: TaskSubmissionOptions
): Promise<string>
```

**Parameters:**

- `prompt`: The user's input prompt
- `options.silent`: Suppress logging (default: false)
- `options.mock`: Use mock responses for testing (default: false)
- `options.attachmentIds` / `options.attachment_ids`: Transient attachment IDs returned by `uploadAttachment()`
- `options.images`: Deprecated compatibility helper; images are uploaded first and submitted as `attachment_ids`
- `options.*`: Any additional TaskForceAI orchestration flags are forwarded untouched

**Returns:** Task ID string

##### `getTaskStatus(taskId)`

Get the current status of a task.

```typescript
async getTaskStatus(taskId: string): Promise<TaskStatus>
```

**Returns:** Object with `taskId`, `status`, `result`, and `error` fields

##### `getTaskResult(taskId)`

Get the final result of a completed task.

```typescript
async getTaskResult(taskId: string): Promise<TaskResult>
```

**Returns:** Object with `taskId` and `result` fields

##### `waitForCompletion(taskId, pollInterval?, maxAttempts?)`

Wait for a task to complete by polling the status.

```typescript
async waitForCompletion(
  taskId: string,
  pollInterval?: number,
  maxAttempts?: number,
  onStatus?: (status: TaskStatus) => void,
  signal?: AbortSignal
): Promise<TaskResult>
```

**Parameters:**

- `pollInterval`: Milliseconds between polls (default: 2000)
- `maxAttempts`: Maximum polling attempts (default: 150)
- `onStatus`: Optional callback invoked each time a new status payload is fetched
- `signal`: Optional abort signal to cancel local polling

##### `runTask(prompt, options?, pollInterval?, maxAttempts?, onStatus?)`

Submit a task and wait for completion in one call.

```typescript
async runTask(
  prompt: string,
  options?: TaskSubmissionOptions,
  pollInterval?: number,
  maxAttempts?: number,
  onStatus?: (status: TaskStatus) => void
): Promise<TaskResult>
```

##### `streamTaskStatus(taskId, pollInterval?, maxAttempts?, onStatus?)`

Returns an `AsyncIterable<TaskStatus>` that yields each status payload. Useful for
building progress UIs or logs. Call `cancel()` on the returned stream to stop polling
locally without cancelling the backend computation.

##### `runTaskStream(prompt, options?, pollInterval?, maxAttempts?, onStatus?)`

Shortcut that submits a prompt and hands back a `TaskStatusStream` immediately so you can
`for await` the updates without waiting for completion.

### Files

Upload, list, inspect, delete, and download files for Developer API workflows:

```typescript
const uploaded = await client.uploadFile('brief.txt', new Blob(['Context for the run']), {
  purpose: 'assistants',
  mime_type: 'text/plain',
});

const files = await client.listFiles(20, 0);
const metadata = await client.getFile(uploaded.id);
const content = await client.downloadFile(uploaded.id);
await client.deleteFile(uploaded.id);
```

For task-scoped images, use transient attachments rather than the persistent files API:

```typescript
const attachmentId = await client.uploadAttachment(
  new File([imageBytes], 'diagram.png', { type: 'image/png' })
);

const taskId = await client.submitTask('Analyze this diagram', {
  attachmentIds: [attachmentId],
});
```

### Threads

Create persistent conversation threads and run prompts inside existing thread context:

```typescript
const thread = await client.createThread({ title: 'Security review' });
const run = await client.runInThread(thread.id, {
  prompt: 'Review the uploaded brief.',
  modelId: 'zai/glm-5.2',
  stream: false,
});

const { conversations } = await client.listThreads(20, 0);
const messages = await client.getThreadMessages(thread.id, 50, 0);
```

`deleteThread()` intentionally returns an SDK error because the current Developer API does not expose a thread delete endpoint.

## Error Handling

The SDK throws `TaskForceAIError` for API errors:

```typescript
import { TaskForceAIError } from 'taskforceai-sdk';

try {
  const result = await client.runTask('Your prompt');
} catch (error) {
  if (error instanceof TaskForceAIError) {
    // handle API error, inspect error.statusCode and error.details
  }
}
```

## Response Hooks & Telemetry

Pass `responseHook` to the constructor to observe every raw HTTP response and capture
rate-limit headers or request IDs before the SDK parses them:

```typescript
const client = new TaskForceAI({
  apiKey: 'key',
  responseHook: (response) => {
    console.log('x-ratelimit-remaining', response.headers.get('x-ratelimit-remaining'));
  },
});
```

## Rate Limiting

The API includes built-in rate limiting. Check the response headers or use the SDK's error handling to manage rate limits.

## Authentication

Get your API key from the TaskForceAI dashboard or contact support.

## Examples

### Basic Usage

```typescript
import { TaskForceAI } from 'taskforceai-sdk';

const client = new TaskForceAI({ apiKey: 'your-key' });

const result = await client.runTask('What are the benefits of renewable energy?');
console.log(result.result);
```

### Advanced Usage with Options

```typescript
const taskId = await client.submitTask('Analyze this code for bugs', {
  silent: true,
  mock: false,
});

const status = await client.getTaskStatus(taskId);
console.log(`Status: ${status.status}`);

if (status.status === 'completed') {
  const result = await client.getTaskResult(taskId);
  console.log(result.result);
}
```

## License

MIT
