import { describe, expect, it } from 'bun:test';

import {
  initialStreamingLifecycleState,
  selectStreamingContentId,
  selectStreamingStatusId,
  streamingLifecycleReducer,
  type StreamingLifecycleState,
} from './lifecycle';

describe('client-core/streaming/lifecycle', () => {
  it('transitions from idle to awaitingPlaceholder on START_STREAM', () => {
    const state = streamingLifecycleReducer(initialStreamingLifecycleState, {
      type: 'START_STREAM',
    });

    expect(state).toEqual({
      state: 'awaitingPlaceholder',
      statusMessageId: null,
      contentMessageId: null,
      bufferedContent: null,
    });
  });

  it('ignores START_STREAM once stream is already active', () => {
    const streamingState: StreamingLifecycleState = {
      state: 'streaming',
      statusMessageId: 'status-1',
      contentMessageId: 'content-1',
      bufferedContent: 'hello',
    };

    const next = streamingLifecycleReducer(streamingState, { type: 'START_STREAM' });

    expect(next).toBe(streamingState);
  });

  it('buffers content before placeholders and carries it into streaming state', () => {
    const awaiting = streamingLifecycleReducer(initialStreamingLifecycleState, {
      type: 'START_STREAM',
    });
    const buffered = streamingLifecycleReducer(awaiting, {
      type: 'BUFFER_CONTENT',
      content: 'partial chunk',
    });
    const streaming = streamingLifecycleReducer(buffered, {
      type: 'PLACEHOLDERS_READY',
      statusMessageId: 'status-1',
      contentMessageId: 'content-1',
    });

    expect(streaming).toEqual({
      state: 'streaming',
      statusMessageId: 'status-1',
      contentMessageId: 'content-1',
      bufferedContent: 'partial chunk',
    });
  });

  it('ignores duplicate buffered content updates', () => {
    const awaiting: StreamingLifecycleState = {
      state: 'awaitingPlaceholder',
      statusMessageId: null,
      contentMessageId: null,
      bufferedContent: 'first',
    };
    expect(
      streamingLifecycleReducer(awaiting, {
        type: 'BUFFER_CONTENT',
        content: 'first',
      })
    ).toBe(awaiting);

    const streaming: StreamingLifecycleState = {
      state: 'streaming',
      statusMessageId: 'status-1',
      contentMessageId: 'content-1',
      bufferedContent: 'first',
    };
    expect(
      streamingLifecycleReducer(streaming, {
        type: 'APPEND_CONTENT',
        content: 'first',
      })
    ).toBe(streaming);
  });

  it('updates buffered content on APPEND_CONTENT only while streaming', () => {
    const awaiting: StreamingLifecycleState = {
      state: 'awaitingPlaceholder',
      statusMessageId: null,
      contentMessageId: null,
      bufferedContent: null,
    };
    const unchanged = streamingLifecycleReducer(awaiting, {
      type: 'APPEND_CONTENT',
      content: 'should-not-apply',
    });
    expect(unchanged).toBe(awaiting);

    const streaming: StreamingLifecycleState = {
      state: 'streaming',
      statusMessageId: 'status-1',
      contentMessageId: 'content-1',
      bufferedContent: 'first',
    };
    const updated = streamingLifecycleReducer(streaming, {
      type: 'APPEND_CONTENT',
      content: 'second',
    });

    expect(updated).toEqual({
      state: 'streaming',
      statusMessageId: 'status-1',
      contentMessageId: 'content-1',
      bufferedContent: 'second',
    });
  });

  it('finalizes from awaitingPlaceholder without placeholder IDs', () => {
    const awaiting: StreamingLifecycleState = {
      state: 'awaitingPlaceholder',
      statusMessageId: null,
      contentMessageId: null,
      bufferedContent: 'partial',
    };

    const next = streamingLifecycleReducer(awaiting, {
      type: 'FINAL_RESPONSE',
      finalResponse: 'final answer',
    });

    expect(next).toEqual({
      state: 'finalizing',
      statusMessageId: null,
      contentMessageId: null,
      finalResponse: 'final answer',
    });
  });

  it('preserves placeholder IDs when finalizing from streaming', () => {
    const streaming: StreamingLifecycleState = {
      state: 'streaming',
      statusMessageId: 'status-1',
      contentMessageId: 'content-1',
      bufferedContent: 'partial',
    };

    const next = streamingLifecycleReducer(streaming, {
      type: 'FINAL_RESPONSE',
      finalResponse: 'final answer',
    });

    expect(next).toEqual({
      state: 'finalizing',
      statusMessageId: 'status-1',
      contentMessageId: 'content-1',
      finalResponse: 'final answer',
    });
  });

  it('captures streaming IDs on error and resets back to idle', () => {
    const streaming: StreamingLifecycleState = {
      state: 'streaming',
      statusMessageId: 'status-1',
      contentMessageId: 'content-1',
      bufferedContent: 'partial',
    };
    const errored = streamingLifecycleReducer(streaming, {
      type: 'ERROR',
      message: 'stream failed',
    });

    expect(errored).toEqual({
      state: 'error',
      statusMessageId: 'status-1',
      contentMessageId: 'content-1',
      message: 'stream failed',
    });

    const reset = streamingLifecycleReducer(errored, { type: 'RESET' });
    expect(reset).toEqual(initialStreamingLifecycleState);
  });

  it('returns selector IDs only for states that expose placeholders', () => {
    const cases: Array<{
      state: StreamingLifecycleState;
      contentId: string | null;
      statusId: string | null;
    }> = [
      { state: { state: 'idle' }, contentId: null, statusId: null },
      {
        state: {
          state: 'awaitingPlaceholder',
          statusMessageId: null,
          contentMessageId: null,
          bufferedContent: null,
        },
        contentId: null,
        statusId: null,
      },
      {
        state: {
          state: 'streaming',
          statusMessageId: 'status-1',
          contentMessageId: 'content-1',
          bufferedContent: null,
        },
        contentId: 'content-1',
        statusId: 'status-1',
      },
      {
        state: {
          state: 'finalizing',
          statusMessageId: 'status-2',
          contentMessageId: 'content-2',
          finalResponse: 'done',
        },
        contentId: 'content-2',
        statusId: 'status-2',
      },
      {
        state: {
          state: 'error',
          statusMessageId: 'status-3',
          contentMessageId: 'content-3',
          message: 'boom',
        },
        contentId: 'content-3',
        statusId: 'status-3',
      },
    ];

    for (const testCase of cases) {
      expect(selectStreamingContentId(testCase.state)).toBe(testCase.contentId);
      expect(selectStreamingStatusId(testCase.state)).toBe(testCase.statusId);
    }
  });
});
