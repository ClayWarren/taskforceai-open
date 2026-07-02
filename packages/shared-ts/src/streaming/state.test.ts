import { describe, expect, it } from 'bun:test';

import { initialStreamingState } from './state';

describe('streaming/state', () => {
  it('exports a non-streaming empty initial state', () => {
    expect(initialStreamingState).toEqual({
      isStreaming: false,
      agentStatuses: [],
      agentLabels: [],
      errorMessage: null,
      rateLimitResetTime: null,
      finalResponse: null,
      streamContent: '',
      reasoning: '',
      finalReasoning: null,
      sources: [],
      finalSources: [],
      toolEvents: [],
      finalToolEvents: [],
      elapsedSeconds: 0,
      modelId: null,
      modelLabel: null,
      modelBadge: null,
      trace_id: null,
      pendingApproval: null,
      computerUseEnabled: false,
      useLoggedInServices: false,
      currentSpend: 0,
      budgetLimit: null,
    });
  });
});
