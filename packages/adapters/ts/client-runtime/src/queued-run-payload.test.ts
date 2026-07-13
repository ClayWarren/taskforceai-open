import { describe, expect, it } from 'bun:test';

import {
  createQueuedRunPayload,
  extractQueuedRunPayloadMetadata,
  hasQueuedMcpClientTools,
  stripQueuedMcpClientTools,
} from './queued-run-payload';

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
        modelId: 'openai/gpt-5.6-sol',
        attachmentIds: [],
      })
    ).toEqual({
      prompt: 'Hello world',
      demo: false,
      modelId: 'openai/gpt-5.6-sol',
    });

    expect(
      createQueuedRunPayload({
        prompt: 'Hello world',
        modelId: 'openai/gpt-5.6-sol',
        attachmentIds: ['att-1'],
      })
    ).toEqual({
      prompt: 'Hello world',
      demo: false,
      modelId: 'openai/gpt-5.6-sol',
      attachment_ids: ['att-1'],
    });
  });

  it('extracts queued run metadata from either attachment key', () => {
    expect(
      extractQueuedRunPayloadMetadata({
        modelId: 'openai/gpt-5.6-sol',
        attachment_ids: ['att-1', 'att-2'],
      })
    ).toEqual({
      modelId: 'openai/gpt-5.6-sol',
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

  it('detects and strips MCP client tools from queued run payloads', () => {
    const runPayload = {
      prompt: 'Use tools',
      demo: false,
      options: {
        quickModeEnabled: true,
        clientTools: {
          mcp: [{ source: 'mcp', serverName: 'docs', toolName: 'lookup' }],
        },
      },
    };

    expect(hasQueuedMcpClientTools(runPayload)).toBe(true);
    expect(hasQueuedMcpClientTools({ options: { clientTools: { mcp: [] } } })).toBe(false);
    expect(hasQueuedMcpClientTools({ options: { clientTools: [{ serverName: 'legacy' }] } })).toBe(
      true
    );
    expect(stripQueuedMcpClientTools(runPayload)).toEqual({
      prompt: 'Use tools',
      demo: false,
      options: {
        quickModeEnabled: true,
      },
    });
    expect(
      stripQueuedMcpClientTools({
        prompt: 'Only tools',
        demo: false,
        options: {
          clientTools: {
            mcp: [{ source: 'mcp', serverName: 'docs', toolName: 'lookup' }],
          },
        },
      })
    ).toEqual({
      prompt: 'Only tools',
      demo: false,
    });
  });

  it('ignores client tools on invalid or optionless payloads', () => {
    expect(hasQueuedMcpClientTools(null)).toBe(false);
    expect(hasQueuedMcpClientTools('not-a-payload')).toBe(false);
    expect(hasQueuedMcpClientTools({ prompt: 'No options' })).toBe(false);
    expect(hasQueuedMcpClientTools({ options: null })).toBe(false);
  });
});
