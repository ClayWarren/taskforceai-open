# Shared Code

This workspace contains code shared across web, desktop (Tauri), and mobile (React Native) platforms and is aliased as `@shared/*`.

## Structure

```
packages/shared-ts/src/
├── analytics/          # Shared analytics events
├── chat/               # Shared chat and model selection helpers
├── config/             # Cross-platform environment parsing/validation
├── errors/             # Shared typed errors and retry helpers
├── json/               # JSON parsing helpers with Result return type
├── logger/             # Transport-based logging primitives
├── logging/            # Structured logging format/sanitization helpers
├── search/             # Local/fuzzy search and keyword utilities
├── streaming/          # Streaming payload normalization and state helpers
├── support/            # Issue-reporting helpers
├── time/               # Clock abstraction for deterministic time
├── types/              # Shared type definitions
└── utils/              # Cross-platform utilities
```

> **Note:** API contracts live in [`packages/contracts-ts`](../contracts-ts). Import shared modules via `@taskforceai/shared/*` export paths instead of deep relative paths.

## API Client

### Basic Usage

```typescript
import { createApiClient } from '@taskforceai/contracts';

// Create a client instance
const client = createApiClient({
  baseUrl: 'http://localhost:3000',
  getToken: () => localStorage.getItem('token'),
});

// Make API calls
const response = await client.runTask({
  prompt: 'Hello, world!',
  use_heavy_mode: true,
});
```

### Browser Client

For web applications, use the pre-configured browser client:

```typescript
import { getBrowserClient } from '@taskforceai/contracts/browserClient';

const client = getBrowserClient();
const conversations = await client.getConversations();
```

### React Hooks

For React applications, use the provided hooks for automatic state management:

```typescript
import { useConversations, useCurrentUser } from '@taskforceai/contracts';

function MyComponent() {
  const { data: conversations, loading, error, refetch } = useConversations(client, 10);
  const { data: user } = useCurrentUser(client);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return <div>{/* Use conversations data */}</div>;
}
```

### Mutations

For operations that modify data:

```typescript
import { useDeleteConversation, useRunTask } from '@taskforceai/contracts';

function MyComponent() {
  const { mutate: runTask, loading, error } = useRunTask(client);
  const { mutate: deleteConversation } = useDeleteConversation(client);

  const handleSubmit = async () => {
    const result = await runTask({
      prompt: 'Test prompt',
      use_heavy_mode: false,
    });
  };

  const handleDelete = async (id: number) => {
    await deleteConversation(id);
  };
}
```

## Utility Functions

### Time & Date

```typescript
import { formatRelativeTime, formatTime } from '@shared/utils';

formatTime(125); // "2M5S"
formatRelativeTime(new Date(Date.now() - 3600000)); // "1 hour ago"
```

### String Operations

```typescript
import { capitalize, slugify, stripHtml, truncate } from '@shared/utils';

truncate('Long text here', 10); // "Long te..."
capitalize('hello'); // "Hello"
slugify('Hello World!'); // "hello-world"
stripHtml('<p>Text</p>'); // "Text"
```

### Validation

```typescript
import { isValidEmail, isValidUrl } from '@shared/utils';

isValidEmail('user@example.com'); // true
isValidUrl('https://example.com'); // true
```

### Array Operations

```typescript
import { chunk, groupBy, unique } from '@shared/utils';

const users = [
  { name: 'Alice', role: 'admin' },
  { name: 'Bob', role: 'user' },
  { name: 'Charlie', role: 'admin' },
];

groupBy(users, 'role');
// { admin: [...], user: [...] }

unique([1, 2, 2, 3]); // [1, 2, 3]
chunk([1, 2, 3, 4, 5], 2); // [[1, 2], [3, 4], [5]]
```

### Async Operations

```typescript
import { debounce, retry, sleep, throttle } from '@shared/utils';

// Delay execution
await sleep(1000);

// Retry with exponential backoff
const result = await retry(
  async () => {
    return await fetchData();
  },
  { retries: 3, delay: 1000, backoff: 2 }
);

// Debounce user input
const debouncedSearch = debounce((query: string) => {
  performSearch(query);
}, 300);

// Throttle scroll events
const throttledScroll = throttle(() => {
  handleScroll();
}, 100);
```

## Type Definitions

All shared types are available in `@shared/types`:

```typescript
import type { AgentStatus, StreamEvent, TaskProgress, ThemeState } from '@shared/types';
```

## Platform-Specific Notes

### Web

- Uses `localStorage` for token storage
- Full DOM support for HTML operations
- FileReader API available

### Mobile (React Native)

- Uses AsyncStorage for token storage
- Limited HTML operations (regex-based)
- Different file handling APIs

### Desktop (Tauri)

- Similar to web but with native APIs
- Can access file system directly
- Enhanced security features

## Error Handling

The API client includes comprehensive error handling:

```typescript
import { ApiClientError, getErrorMessage, isApiError } from '@taskforceai/contracts';
import { Logger } from '@taskforceai/logger';

const logger = new Logger({ context: { component: 'shared-api-client' } });

try {
  await client.runTask(request);
} catch (error) {
  if (isApiError(error, 401)) {
    // Handle unauthorized
  } else if (isApiError(error, 429)) {
    // Handle rate limit
  } else {
    logger.error('Request failed', { message: getErrorMessage(error), error });
  }
}
```

## Best Practices

1. **Type Safety**: Always use TypeScript types from `@shared/types` and `@taskforceai/contracts`
2. **Error Handling**: Use `isApiError` and `getErrorMessage` for consistent error handling
3. **React Hooks**: Prefer hooks over direct API calls in React components
4. **Reusability**: Add new shared utilities here instead of duplicating across platforms
5. **Documentation**: Document new utilities and types with JSDoc comments

## Contributing

When adding new shared code:

1. Add proper TypeScript types
2. Include JSDoc documentation
3. Write unit tests
4. Update this README
5. Ensure cross-platform compatibility
