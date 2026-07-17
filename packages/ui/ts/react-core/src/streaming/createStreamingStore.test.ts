import { describe, expect, it } from 'bun:test';

import { createStreamingStore as canonicalCreateStreamingStore } from '@taskforceai/client-runtime';

import { createStreamingStore } from './createStreamingStore';
import type {
  PrepareStreamingOptions,
  StartStreamingOptions,
  StreamSettlement,
  StreamingStoreAdapter,
  StreamingStoreState,
} from './createStreamingStore';

describe('createStreamingStore compatibility facade', () => {
  it('re-exports the canonical runtime function and public types', () => {
    const prepareOptions: PrepareStreamingOptions = {
      conversationId: 'conversation-1',
      prompt: 'hello',
    };
    const startOptions: StartStreamingOptions = {
      ...prepareOptions,
      taskId: 'task-1',
    };
    const settlement: StreamSettlement = 'abort';
    const adapter: StreamingStoreAdapter = {
      connect: async () => () => undefined,
      logger: {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    };
    const state: StreamingStoreState = createStreamingStore(adapter).getState();

    expect(createStreamingStore).toBe(canonicalCreateStreamingStore);
    expect(startOptions.taskId).toBe('task-1');
    expect(settlement).toBe('abort');
    expect(typeof state.prepareStreaming).toBe('function');
  });
});
