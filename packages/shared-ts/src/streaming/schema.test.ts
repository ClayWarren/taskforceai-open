import { describe, expect, it } from 'bun:test';

import { parseStreamingPayload } from './schema';

describe('shared-ts/streaming/schema', () => {
  it('parses a valid payload', () => {
    const result = parseStreamingPayload(
      JSON.stringify({
        type: 'progress',
        agent_statuses: [{ status: 'QUEUED', agent_id: 1 }],
      })
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe('progress');
      expect(result.value.agent_statuses?.[0]?.status).toBe('QUEUED');
    }
  });

  it('preserves reasoning and model fields on agent statuses', () => {
    const result = parseStreamingPayload(
      JSON.stringify({
        type: 'progress',
        agent_statuses: [
          { status: 'RUNNING', agent_id: 1, reasoning: 'Checking files', model: 'xai/grok-4.3' },
        ],
      })
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.agent_statuses?.[0]?.reasoning).toBe('Checking files');
      expect(result.value.agent_statuses?.[0]?.model).toBe('xai/grok-4.3');
    }
  });

  it('tolerates nullable optional agent status fields from backend progress snapshots', () => {
    const result = parseStreamingPayload(
      JSON.stringify({
        type: 'progress',
        agent_statuses: [
          {
            status: 'PROCESSING...',
            agent_id: 0,
            progress: 0.72,
            result: null,
            reasoning: null,
            model: 'anthropic/claude-fable-5',
          },
        ],
        reasoning: 'thinking',
      })
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.reasoning).toBe('thinking');
      expect(result.value.agent_statuses?.[0]?.result).toBeUndefined();
      expect(result.value.agent_statuses?.[0]?.reasoning).toBeUndefined();
      expect(result.value.agent_statuses?.[0]?.model).toBe('anthropic/claude-fable-5');
    }
  });

  it('preserves tool event image data', () => {
    const result = parseStreamingPayload(
      JSON.stringify({
        type: 'progress',
        tool_event: {
          tool_name: 'computer_use',
          status: 'completed',
          image_base64: 'abc123',
        },
      })
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const toolEvent = result.value.tool_event;
      if (toolEvent && typeof toolEvent === 'object' && 'image_base64' in toolEvent) {
        expect(toolEvent.image_base64).toBe('abc123');
      } else {
        throw new Error('Expected tool_event with image_base64');
      }
    }
  });

  it('parses valid numeric budget usage payloads', () => {
    const result = parseStreamingPayload(
      JSON.stringify({
        type: 'progress',
        budget_usage: { consumedUsd: 0.12, remainingUsd: 0.88 },
      })
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.budget_usage?.consumedUsd).toBe(0.12);
      expect(result.value.budget_usage?.remainingUsd).toBe(0.88);
    }
  });

  it('returns INVALID_JSON for malformed json', () => {
    const result = parseStreamingPayload('{not-json');
    expect(result).toEqual({ ok: false, error: 'INVALID_JSON' });
  });

  it('returns INVALID_PAYLOAD when required fields are missing', () => {
    const result = parseStreamingPayload(JSON.stringify({ agent_statuses: [] }));
    expect(result).toEqual({ ok: false, error: 'INVALID_PAYLOAD' });
  });

  it('returns INVALID_PAYLOAD when budget_usage.consumedUsd is not numeric', () => {
    const result = parseStreamingPayload(
      JSON.stringify({
        type: 'progress',
        budget_usage: { consumedUsd: '0.12' },
      })
    );
    expect(result).toEqual({ ok: false, error: 'INVALID_PAYLOAD' });
  });

  it('returns INVALID_PAYLOAD for empty input payload', () => {
    const result = parseStreamingPayload('');
    expect(result).toEqual({ ok: false, error: 'INVALID_PAYLOAD' });
  });

  it('returns INVALID_PAYLOAD when agent_statuses is null', () => {
    const result = parseStreamingPayload(
      JSON.stringify({
        type: 'progress',
        agent_statuses: null,
      })
    );
    expect(result).toEqual({ ok: false, error: 'INVALID_PAYLOAD' });
  });

  it('parses legacy tool_event payloads through fallback parser branch', () => {
    const result = parseStreamingPayload(
      JSON.stringify({
        type: 'progress',
        tool_event: {
          tool_name: 'search_web',
          status: 'running',
          custom_field: 'preserved',
        },
      })
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe('progress');
      const toolEvent = result.value.tool_event as Record<string, unknown>;
      expect(toolEvent['tool_name']).toBe('search_web');
      expect(toolEvent['custom_field']).toBe('preserved');
    }
  });

  it('parses permissive tool_events payload entries when canonical schema does not match', () => {
    const result = parseStreamingPayload(
      JSON.stringify({
        type: 'progress',
        tool_events: [
          {
            timestamp: 12345,
            tool_call_id: 'call-1',
            status: 'completed',
          },
        ],
      })
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const firstEvent = result.value.tool_events?.[0] as Record<string, unknown> | undefined;
      expect(firstEvent?.['tool_call_id']).toBe('call-1');
      expect(firstEvent?.['status']).toBe('completed');
    }
  });
});
