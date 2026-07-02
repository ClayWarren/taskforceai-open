import { describe, expect, it } from 'bun:test';
import { runRequestSchema } from '@taskforceai/contracts/contracts';
import type { PendingChange } from '@taskforceai/persistence';

import {
  createPendingChangeFromPrompt,
  createPendingPromptInsert,
  createPendingPromptUpdate,
  isRecord,
  toPendingStatus,
  toRunPayload,
} from './dexie-pending-changes';

describe('dexie pending prompt change mappers', () => {
  const runPayload = runRequestSchema.parse({
    prompt: 'Generate a plan',
    demo: false,
    modelId: 'openai/gpt-5.5',
    attachment_ids: ['att-1'],
    options: { mode: 'direct' },
  });

  it('recognizes records, pending statuses, and valid run payloads', () => {
    expect(isRecord({ prompt: 'hello' })).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord('not-object')).toBe(false);

    expect(toPendingStatus('pending')).toBe('pending');
    expect(toPendingStatus('failed')).toBe('failed');
    expect(toPendingStatus('queued')).toBe('queued');
    expect(toPendingStatus('done')).toBeNull();

    expect(toRunPayload(runPayload)).toEqual(runPayload);
    expect(toRunPayload({ prompt: '' })).toBeNull();
  });

  it('creates pending changes from prompts and preserves only valid run payloads', () => {
    expect(
      createPendingChangeFromPrompt({
        id: 12,
        conversationId: 'conv-1',
        prompt: 'Generate a plan',
        status: 'queued',
        createdAt: 1710000000000,
        runPayload,
      })
    ).toEqual({
      id: 12,
      type: 'prompt',
      entityId: 'conv-1',
      operation: 'create',
      data: {
        prompt: 'Generate a plan',
        status: 'queued',
        runPayload,
      },
      createdAt: 1710000000000,
    });

    expect(
      createPendingChangeFromPrompt({
        conversationId: 'conv-2',
        prompt: 'Retry later',
        status: 'failed',
        createdAt: 1710000001000,
        runPayload: { prompt: '' },
      })
    ).toEqual({
      type: 'prompt',
      entityId: 'conv-2',
      operation: 'create',
      data: {
        prompt: 'Retry later',
        status: 'failed',
      },
      createdAt: 1710000001000,
    });
  });

  it('creates Dexie pending prompt inserts from pending changes with safe defaults', () => {
    const change = {
      type: 'prompt',
      entityId: 'conv-1',
      operation: 'create',
      data: {
        prompt: 'Generate a plan',
        status: 'pending',
        runPayload,
      },
      createdAt: 1710000000000,
    } satisfies PendingChange;

    expect(createPendingPromptInsert(change)).toEqual({
      conversationId: 'conv-1',
      prompt: 'Generate a plan',
      createdAt: 1710000000000,
      status: 'pending',
      runPayload,
    });

    expect(
      createPendingPromptInsert({
        ...change,
        entityId: 'conv-2',
        data: {
          prompt: 42,
          status: 'unknown',
          runPayload: { prompt: '' },
        },
      })
    ).toEqual({
      conversationId: 'conv-2',
      prompt: '',
      createdAt: 1710000000000,
      status: 'queued',
    });

    expect(
      createPendingPromptInsert({
        ...change,
        entityId: 'conv-3',
        data: 'not-an-object',
      })
    ).toEqual({
      conversationId: 'conv-3',
      prompt: '',
      createdAt: 1710000000000,
      status: 'queued',
    });
  });

  it('creates partial prompt updates and rejects empty or non-record payloads', () => {
    expect(
      createPendingPromptUpdate({
        prompt: 'Updated prompt',
        status: 'failed',
        runPayload,
      })
    ).toEqual({
      prompt: 'Updated prompt',
      status: 'failed',
      runPayload,
    });

    expect(createPendingPromptUpdate({ prompt: 'Only prompt' })).toEqual({
      prompt: 'Only prompt',
    });
    expect(createPendingPromptUpdate({ status: 'queued' })).toEqual({
      status: 'queued',
    });
    expect(createPendingPromptUpdate({ runPayload })).toEqual({ runPayload });
    expect(createPendingPromptUpdate(null)).toBeNull();
    expect(createPendingPromptUpdate({ status: 'done', runPayload: { prompt: '' } })).toBeNull();
  });
});
