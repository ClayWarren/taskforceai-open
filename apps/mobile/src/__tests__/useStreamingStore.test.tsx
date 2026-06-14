import { describe, it, jest, beforeEach, afterEach, expect } from '@jest/globals';
import { act } from '@testing-library/react-native';

import type { StreamingPayload } from '@taskforceai/shared/streaming/types';
jest.mock('../api/client', () => ({
  getMobileAuthClient: () => ({
    getToken: jest.fn<any>().mockResolvedValue({ ok: true, value: 'mock-token' }),
  }),
}));

jest.mock('../config/base-url', () => ({
  getMobileBaseUrl: () => 'https://api.taskforceai.chat',
}));

jest.mock('../config/env', () => ({
  mobileEnv: { flags: { verboseStreaming: false } },
}));

import { useStreamingStore } from '../streaming/useStreamingStore';

// Mock react-native-sse
jest.mock('react-native-sse', () => {
  return class MockEventSource {
    static instances: MockEventSource[] = [];
    url: string;
    options: any;
    closed = false;
    readyState = 0;
    private listeners: Map<string, Set<any>> = new Map();

    constructor(url: string, options: any = {}) {
      this.url = url;
      this.options = options;
      MockEventSource.instances.push(this);
    }

    addEventListener(type: string, listener: any) {
      if (!this.listeners.has(type)) {
        this.listeners.set(type, new Set());
      }
      this.listeners.get(type)!.add(listener);
    }

    removeEventListener(type: string, listener: any) {
      this.listeners.get(type)?.delete(listener);
    }

    emit(type: string, event: { data?: string } = {}) {
      if (type === 'open') {
        this.readyState = 1;
      }
      for (const handler of this.listeners.get(type) ?? []) {
        handler(event);
      }
    }

    close() {
      this.closed = true;
      this.readyState = 2;
    }
  };
});

const MockEventSource = require('react-native-sse');

describe('useStreamingStore', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    MockEventSource.instances = [];
    useStreamingStore.getState().reset();
  });

  afterEach(() => {
    jest.useRealTimers();
    useStreamingStore.getState().stopStreaming();
  });

  it('handles streaming lifecycle correctly', async () => {
    let settledReason: string | null = null;
    let startPromise!: Promise<void>;

    await act(async () => {
      startPromise = useStreamingStore.getState().startStreaming({
        taskId: 'run-123',
        conversationId: 'conv-1',
        prompt: 'Explain TaskForceAI',
        onSettled: (reason) => {
          settledReason = reason;
        },
      });
    });

    const instance = MockEventSource.instances.at(-1);
    expect(instance).toBeDefined();
    expect(instance.url).toBe('https://api.taskforceai.chat/api/v1/stream/run-123');

    await act(async () => {
      instance.emit('open');
    });

    await act(async () => {
      await startPromise;
    });

    // Advance timers to test elapsed seconds
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(useStreamingStore.getState().elapsedSeconds).toBe(2);

    const progressPayload: StreamingPayload = {
      type: 'progress',
      chunk: 'Working… see [Example](https://example.com)',
      agent_statuses: [
        {
          agent_id: 42,
          status: 'running',
          result: 'Review https://agent-source.com for context',
        },
      ],
    };

    await act(async () => {
      instance.emit('message', { data: JSON.stringify(progressPayload) });
    });

    const progressState = useStreamingStore.getState();
    expect(progressState.isStreaming).toBe(true);
    expect(progressState.streamContent).toBe('Working… see [Example](https://example.com)');
    expect(progressState.sources.some((source) => source.url.includes('example.com'))).toBe(true);

    const completionPayload: StreamingPayload = {
      type: 'complete',
      message: 'Final answer referencing https://final-source.dev',
    };

    await act(async () => {
      instance.emit('message', { data: JSON.stringify(completionPayload) });
    });
    await act(async () => {
      instance.emit('error', {});
    });

    const finalState = useStreamingStore.getState();
    expect(finalState.isStreaming).toBe(false);
    expect(finalState.finalResponse).toBe(completionPayload.message);
    expect(settledReason).toBe('complete');
    expect(instance.closed).toBe(true);
  });

  it('handles connection errors', async () => {
    let startError: Error | null = null;
    let startPromise!: Promise<void>;

    await act(async () => {
      startPromise = useStreamingStore.getState().startStreaming({
        taskId: 'run-err',
        conversationId: 'conv-err',
        prompt: 'Trigger error',
      });
      startPromise.catch(err => {
        startError = err;
      });
    });

    const instance = MockEventSource.instances.at(-1);
    expect(instance).toBeDefined();

    await act(async () => {
      instance.emit('error', {});
    });

    await act(async () => {
      try { await startPromise; } catch { /* ignore */ }
    });

    expect(useStreamingStore.getState().isStreaming).toBe(false);
    expect(startError).toBeDefined();
    expect(instance.closed).toBe(true);
  });

  it('does not treat nested terminal-looking payload text as stream completion', async () => {
    let startPromise!: Promise<void>;
    await act(async () => {
      startPromise = useStreamingStore.getState().startStreaming({
        taskId: 'run-truncated',
        conversationId: 'conv-truncated',
        prompt: 'Explain the SSE protocol',
      });
    });

    const instance = MockEventSource.instances.at(-1);
    expect(instance).toBeDefined();

    await act(async () => {
      instance.emit('open');
    });
    await act(async () => {
      await startPromise;
    });

    await act(async () => {
      instance.emit('message', {
        data: JSON.stringify({
          type: 'progress',
          chunk: 'Still working',
          agent_statuses: [{ agent_id: 1, status: 'running', result: { type: 'complete' } }],
        }),
      });
    });
    await act(async () => {
      instance.closed = true;
      instance.readyState = 2;
      instance.emit('error', {});
    });

    expect(useStreamingStore.getState().isStreaming).toBe(false);
    expect(useStreamingStore.getState().errorMessage).toBeTruthy();
  });

  it('handles error payload from server', async () => {
    let startPromise!: Promise<void>;
    await act(async () => {
      startPromise = useStreamingStore.getState().startStreaming({
        taskId: 'run-error-payload',
        conversationId: 'conv',
        prompt: 'Generate error payload test',
      });
    });

    const instance = MockEventSource.instances.at(-1);
    expect(instance).toBeDefined();

    await act(async () => {
      instance.emit('open');
    });

    await act(async () => {
      await startPromise;
    });

    await act(async () => {
      instance.emit('message', {
        data: JSON.stringify({ type: 'error', error: 'Rate limit reached' }),
      });
    });

    expect(useStreamingStore.getState().errorMessage).toBe('Rate limit reached');
    expect(useStreamingStore.getState().isStreaming).toBe(false);
    expect(instance.closed).toBe(true);
  });

  it('passes authorization header when token is available', async () => {
    let startPromise!: Promise<void>;

    await act(async () => {
      startPromise = useStreamingStore.getState().startStreaming({
        taskId: 'run-auth',
        conversationId: 'conv-auth',
        prompt: 'test auth',
      });
    });

    const instance = MockEventSource.instances.at(-1);
    expect(instance.options.headers.Authorization).toBe('Bearer mock-token');

    await act(async () => {
      instance.emit('error', {});
      try { await startPromise; } catch { /* ignore */ }
    });
  });
});
