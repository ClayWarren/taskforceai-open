import { describe, expect, it } from 'bun:test';

import { createQueuedRunPayload, extractQueuedRunPayloadMetadata } from './queued-run-payload';

describe('queued-run-payload', () => {
  it('creates queued run payload only when metadata exists', () => {
    expect(
      createQueuedRunPayload({
        prompt: 'Hello world',
      })
    ).toBeUndefined();

    expect(
      createQueuedRunPayload({
        prompt: 'Hello world',
        attachmentIds: ['att-only'],
      })
    ).toEqual({
      prompt: 'Hello world',
      demo: false,
      attachment_ids: ['att-only'],
    });

    expect(
      createQueuedRunPayload({
        prompt: 'Hello world',
        modelId: 'openai/gpt-5.5',
        attachmentIds: [],
      })
    ).toEqual({
      prompt: 'Hello world',
      demo: false,
      modelId: 'openai/gpt-5.5',
    });

    expect(
      createQueuedRunPayload({
        prompt: 'Hello world',
        modelId: 'openai/gpt-5.5',
        attachmentIds: ['att-1'],
      })
    ).toEqual({
      prompt: 'Hello world',
      demo: false,
      modelId: 'openai/gpt-5.5',
      attachment_ids: ['att-1'],
    });
  });

  it('extracts queued run metadata from either attachment key', () => {
    expect(
      extractQueuedRunPayloadMetadata({
        modelId: 'openai/gpt-5.5',
        attachment_ids: ['att-1', 'att-2'],
      })
    ).toEqual({
      modelId: 'openai/gpt-5.5',
      attachmentIds: ['att-1', 'att-2'],
    });

    expect(
      extractQueuedRunPayloadMetadata({
        attachmentIds: ['att-3'],
      })
    ).toEqual({
      attachmentIds: ['att-3'],
    });

    expect(
      extractQueuedRunPayloadMetadata({
        modelId: '',
        attachment_ids: ['att-4', 5, null],
      })
    ).toEqual({
      attachmentIds: ['att-4'],
    });

    expect(extractQueuedRunPayloadMetadata(null)).toEqual({});
    expect(extractQueuedRunPayloadMetadata('bad')).toEqual({});
  });
});
