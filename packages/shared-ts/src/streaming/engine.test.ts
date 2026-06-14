import { describe, expect, it, vi } from 'bun:test';
import {
  handleStreamingPayload,
  type StreamingEngineContext,
  type StreamingSetters,
} from './engine';
import type { StreamingState } from './state';
import type { StreamingPayload } from './types';

const createMockSetters = (): StreamingSetters => ({
  setModelId: vi.fn(),
  setModelLabel: vi.fn(),
  setModelBadge: vi.fn(),
  setAgentStatuses: vi.fn(),
  setSources: vi.fn(),
  setFinalSources: vi.fn(),
  setToolEvents: vi.fn(),
  setFinalToolEvents: vi.fn(),
  setReasoning: vi.fn(),
  setFinalReasoning: vi.fn(),
  setFinalResponse: vi.fn(),
  setStreamContent: vi.fn(),
  setTraceId: vi.fn(),
  setPendingApproval: vi.fn(),
  setElapsedSeconds: vi.fn(),
  setIsStreaming: vi.fn(),
  setErrorMessage: vi.fn(),
  setCurrentSpend: vi.fn(),
  closeStream: vi.fn(),
  onConversationId: vi.fn(),
  onApproval: vi.fn(),
});

const createMockContext = (
  overrides?: Partial<StreamingEngineContext>
): StreamingEngineContext => ({
  state: {
    modelId: null,
    modelLabel: null,
    modelBadge: null,
    agentStatuses: [],
    agentLabels: [],
    sources: [],
    finalSources: [],
    toolEvents: [],
    finalToolEvents: [],
    reasoning: '',
    finalReasoning: null,
    finalResponse: null,
    streamContent: '',
    traceId: null,
    pendingApproval: null,
    elapsedSeconds: 0,
    isStreaming: true,
    errorMessage: null,
    errorResetTime: null,
    rateLimitResetTime: null,
    trace_id: null,
    computerUseEnabled: false,
    useLoggedInServices: false,
    budgetLimit: null,
    currentSpend: 0,
  } as StreamingState,
  setters: createMockSetters(),
  refs: {
    sources: [],
    toolEvents: [],
    reasoning: '',
    agentCount: null,
    streamStartTime: Date.now(),
    ttftReported: false,
    agentLabels: [],
  },
  debug: false,
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  ...overrides,
});

describe('handleStreamingPayload', () => {
  describe('start payload', () => {
    it('sets model_id when provided', () => {
      const ctx = createMockContext();
      const payload: StreamingPayload = { type: 'start', model_id: 'gpt-4' };
      handleStreamingPayload(ctx, payload);
      expect(ctx.setters.setModelId).toHaveBeenCalledWith('gpt-4');
    });

    it('sets model_label when provided', () => {
      const ctx = createMockContext();
      const payload: StreamingPayload = { type: 'start', model_label: 'GPT-4' };
      handleStreamingPayload(ctx, payload);
      expect(ctx.setters.setModelLabel).toHaveBeenCalledWith('GPT-4');
    });

    it('sets model_badge when provided', () => {
      const ctx = createMockContext();
      const payload: StreamingPayload = { type: 'start', model_badge: 'Pro' };
      handleStreamingPayload(ctx, payload);
      expect(ctx.setters.setModelBadge).toHaveBeenCalledWith('Pro');
    });

    it('initializes agent statuses when agent_count provided', () => {
      const ctx = createMockContext();
      const payload: StreamingPayload = { type: 'start', agent_count: 3 };
      handleStreamingPayload(ctx, payload);
      expect(ctx.setters.setAgentStatuses).toHaveBeenCalledWith([
        { agent_id: 0, status: 'QUEUED', progress: 0 },
        { agent_id: 1, status: 'QUEUED', progress: 0 },
        { agent_id: 2, status: 'QUEUED', progress: 0 },
      ]);
      expect(ctx.refs.agentCount).toBe(3);
    });

    it('uses launch labels when backend only sends an agent count', () => {
      const ctx = createMockContext({
        refs: { ...createMockContext().refs, agentLabels: ['model-a', 'model-b'] },
      });

      handleStreamingPayload(ctx, { type: 'start', agent_count: 2 });

      expect(ctx.setters.setAgentStatuses).toHaveBeenCalledWith([
        { agent_id: 0, status: 'QUEUED', progress: 0, model: 'model-a' },
        { agent_id: 1, status: 'QUEUED', progress: 0, model: 'model-b' },
      ]);
    });

    it('does not shrink existing agent statuses when backend reports a smaller count', () => {
      const ctx = createMockContext({
        state: {
          ...createMockContext().state,
          agentStatuses: [
            { agent_id: 0, status: 'QUEUED', progress: 0.05, model: 'model-a' },
            { agent_id: 1, status: 'QUEUED', progress: 0.05, model: 'model-b' },
            { agent_id: 2, status: 'QUEUED', progress: 0.05, model: 'model-c' },
            { agent_id: 3, status: 'QUEUED', progress: 0.05, model: 'model-d' },
          ],
        } as StreamingState,
        refs: { ...createMockContext().refs, agentCount: 4 },
      });

      handleStreamingPayload(ctx, { type: 'start', agent_count: 2 });

      expect(ctx.setters.setAgentStatuses).toHaveBeenCalledWith([
        { agent_id: 0, status: 'QUEUED', progress: 0, model: 'model-a' },
        { agent_id: 1, status: 'QUEUED', progress: 0, model: 'model-b' },
        { agent_id: 2, status: 'QUEUED', progress: 0.05, model: 'model-c' },
        { agent_id: 3, status: 'QUEUED', progress: 0.05, model: 'model-d' },
      ]);
      expect(ctx.refs.agentCount).toBe(4);
    });

    it('ignores agent_count of 0', () => {
      const ctx = createMockContext();
      const payload: StreamingPayload = { type: 'start', agent_count: 0 };
      handleStreamingPayload(ctx, payload);
      expect(ctx.setters.setAgentStatuses).not.toHaveBeenCalled();
      expect(ctx.refs.agentCount).toBe(null);
    });
  });

  describe('progress payload', () => {
    it('reports TTFT on first chunk', () => {
      const ctx = createMockContext({
        refs: { ...createMockContext().refs, streamStartTime: Date.now() - 100 },
      });
      const payload: StreamingPayload = { type: 'progress', chunk: 'Hello' };
      handleStreamingPayload(ctx, payload);
      expect(ctx.refs.ttftReported).toBe(true);
      expect(ctx.logger.info).toHaveBeenCalled();
    });

    it('sets agent_statuses when provided', () => {
      const ctx = createMockContext();
      const statuses = [{ agent_id: 0, status: 'RUNNING', progress: 0.5 }];
      const payload: StreamingPayload = { type: 'progress', agent_statuses: statuses };
      handleStreamingPayload(ctx, payload);
      expect(ctx.setters.setAgentStatuses).toHaveBeenCalledWith(statuses);
    });

    it('merges sparse backend progress without removing agents or model labels', () => {
      const ctx = createMockContext({
        state: {
          ...createMockContext().state,
          agentStatuses: [
            { agent_id: 0, status: 'QUEUED', progress: 0.05, model: 'model-a' },
            { agent_id: 1, status: 'QUEUED', progress: 0.05, model: 'model-b' },
            { agent_id: 2, status: 'QUEUED', progress: 0.05, model: 'model-c' },
            { agent_id: 3, status: 'QUEUED', progress: 0.05, model: 'model-d' },
          ],
        } as StreamingState,
        refs: { ...createMockContext().refs, agentCount: 4 },
      });

      handleStreamingPayload(ctx, {
        type: 'progress',
        agent_statuses: [
          { agent_id: 0, status: 'COMPLETED', progress: 1 },
          { agent_id: 1, status: 'PROCESSING...', progress: 0.5 },
        ],
      });

      expect(ctx.setters.setAgentStatuses).toHaveBeenCalledWith([
        { agent_id: 0, status: 'COMPLETED', progress: 1, model: 'model-a' },
        { agent_id: 1, status: 'PROCESSING...', progress: 0.5, model: 'model-b' },
        { agent_id: 2, status: 'QUEUED', progress: 0.05, model: 'model-c' },
        { agent_id: 3, status: 'QUEUED', progress: 0.05, model: 'model-d' },
      ]);
    });

    it('preserves launch labels when progress arrives without model fields', () => {
      const ctx = createMockContext({
        refs: { ...createMockContext().refs, agentCount: 2, agentLabels: ['gpt-5.5', 'grok-4.3'] },
      });

      handleStreamingPayload(ctx, {
        type: 'progress',
        agent_statuses: [
          { agent_id: 0, status: 'PROCESSING...', progress: 0.4 },
          { agent_id: 1, status: 'PROCESSING...', progress: 0.3 },
        ],
      });

      expect(ctx.setters.setAgentStatuses).toHaveBeenCalledWith([
        { agent_id: 0, status: 'PROCESSING...', progress: 0.4, model: 'gpt-5.5' },
        { agent_id: 1, status: 'PROCESSING...', progress: 0.3, model: 'grok-4.3' },
      ]);
    });

    it('sets stream content when chunk provided', () => {
      const ctx = createMockContext();
      const payload: StreamingPayload = { type: 'progress', chunk: 'Hello world' };
      handleStreamingPayload(ctx, payload);
      expect(ctx.setters.setStreamContent).toHaveBeenCalledWith('Hello world');
    });

    it('accumulates reasoning', () => {
      const ctx = createMockContext({ refs: { ...createMockContext().refs, reasoning: 'First' } });
      const payload: StreamingPayload = { type: 'progress', reasoning: ' Second' };
      handleStreamingPayload(ctx, payload);
      expect(ctx.refs.reasoning).toBe('First Second');
      expect(ctx.setters.setReasoning).toHaveBeenCalledWith('First Second');
    });

    it('sets current spend from budget_usage', () => {
      const ctx = createMockContext();
      const payload: StreamingPayload = { type: 'progress', budget_usage: { consumedUsd: 0.05 } };
      handleStreamingPayload(ctx, payload);
      expect(ctx.setters.setCurrentSpend).toHaveBeenCalledWith(0.05);
    });

    it('ignores non-finite budget_usage values', () => {
      const ctx = createMockContext();
      const payload: StreamingPayload = {
        type: 'progress',
        budget_usage: { consumedUsd: Number.NaN },
      };
      handleStreamingPayload(ctx, payload);
      expect(ctx.setters.setCurrentSpend).not.toHaveBeenCalled();
    });

    it('sets pending approval when provided', () => {
      const ctx = createMockContext();
      const approval = { permission: 'fs.read', agentName: 'agent-1', patterns: [], metadata: {} };
      const payload: StreamingPayload = { type: 'progress', pending_approval: approval };
      handleStreamingPayload(ctx, payload);
      expect(ctx.setters.setPendingApproval).toHaveBeenCalledWith(approval);
      expect(ctx.setters.onApproval).toHaveBeenCalledWith(approval);
    });

    it('preserves pending approval on progress without an explicit approval field', () => {
      const ctx = createMockContext();
      const payload: StreamingPayload = { type: 'progress', chunk: 'test' };
      handleStreamingPayload(ctx, payload);
      expect(ctx.setters.setPendingApproval).not.toHaveBeenCalled();
      expect(ctx.setters.onApproval).not.toHaveBeenCalled();
    });

    it('clears pending approval when progress explicitly sends null', () => {
      const ctx = createMockContext();
      const payload: StreamingPayload = { type: 'progress', pending_approval: null };
      handleStreamingPayload(ctx, payload);
      expect(ctx.setters.setPendingApproval).toHaveBeenCalledWith(null);
      expect(ctx.setters.onApproval).toHaveBeenCalledWith(null);
    });

    it('normalizes tool_events array from progress payload', () => {
      const ctx = createMockContext();
      const payload: StreamingPayload = {
        type: 'progress',
        tool_events: [{ tool_name: 'search', status: 'completed' }],
      };
      handleStreamingPayload(ctx, payload);
      expect(ctx.refs.toolEvents).toHaveLength(1);
      expect(ctx.setters.setToolEvents).toHaveBeenCalled();
    });

    it('normalizes legacy tool_usage array from progress payload', () => {
      const ctx = createMockContext();
      const payload: StreamingPayload = {
        type: 'progress',
        tool_usage: [{ agent_id: 0, tool_name: 'search_web', status: 'running' }],
      };
      handleStreamingPayload(ctx, payload);
      expect(ctx.refs.toolEvents).toHaveLength(1);
      expect(ctx.refs.toolEvents[0]).toMatchObject({
        agentId: 0,
        toolName: 'search_web',
        status: 'running',
      });
      expect(ctx.setters.setToolEvents).toHaveBeenCalled();
    });

    it('merges tool_events arrays from progress payloads without dropping existing events', () => {
      const ctx = createMockContext({
        refs: {
          ...createMockContext().refs,
          toolEvents: [
            {
              timestamp: '2026-01-01T00:00:00.000Z',
              agentLabel: 'Agent 1',
              toolName: 'search',
              arguments: {},
              success: true,
              durationMs: 10,
            },
          ],
        },
      });
      const payload: StreamingPayload = {
        type: 'progress',
        tool_events: [
          {
            timestamp: '2026-01-01T00:00:01.000Z',
            agent_label: 'Agent 2',
            tool_name: 'web_fetch',
            status: 'completed',
          },
        ],
      };

      handleStreamingPayload(ctx, payload);

      expect(ctx.refs.toolEvents.map((event) => event.toolName)).toEqual(['search', 'web_fetch']);
    });

    it('deduplicates repeated progress tool events even when arrival timestamps differ', () => {
      const ctx = createMockContext();
      const event = {
        agent_id: 0,
        tool_name: 'search_web',
        status: 'completed',
        arguments: { query: 'latest AI news' },
        duration_ms: 125,
        tool_output: 'Found source',
        sources: [{ url: 'https://example.com/news', title: 'News' }],
      };

      handleStreamingPayload(ctx, { type: 'progress', tool_events: [event] });
      handleStreamingPayload(ctx, { type: 'progress', tool_events: [event] });

      expect(ctx.refs.toolEvents).toHaveLength(1);
      expect(ctx.refs.toolEvents[0]).toMatchObject({
        agentId: 0,
        toolName: 'search_web',
        arguments: { query: 'latest AI news' },
        resultPreview: 'Found source',
      });
    });

    it('replaces in-progress tool events with completed events for the same invocation', () => {
      const ctx = createMockContext();

      handleStreamingPayload(ctx, {
        type: 'progress',
        tool_events: [
          {
            agent_id: 0,
            agent_label: 'AGENT 1',
            tool_name: 'search_web',
            arguments: { query: 'latest AI news' },
          },
        ],
      });
      handleStreamingPayload(ctx, {
        type: 'progress',
        tool_events: [
          {
            agent_id: 0,
            agent_label: 'AGENT 1',
            tool_name: 'search_web',
            arguments: { query: 'latest AI news' },
            duration_ms: 450,
            tool_output: 'Found source',
            sources: [{ url: 'https://example.com/news', title: 'News' }],
          },
        ],
      });

      expect(ctx.refs.toolEvents).toHaveLength(1);
      expect(ctx.refs.toolEvents[0]).toMatchObject({
        agentId: 0,
        agentLabel: 'AGENT 1',
        toolName: 'search_web',
        durationMs: 450,
        resultPreview: 'Found source',
        sources: [{ url: 'https://example.com/news', title: 'News' }],
      });
    });

    it('replaces pending tool events by invocation id when completed arguments change shape', () => {
      const ctx = createMockContext();

      handleStreamingPayload(ctx, {
        type: 'progress',
        tool_events: [
          {
            invocationId: 'call-search-1',
            agent_id: 0,
            agent_label: 'AGENT 1',
            tool_name: 'search_web',
            arguments: '{"query":"latest AI news"}',
          },
        ],
      });
      handleStreamingPayload(ctx, {
        type: 'progress',
        tool_events: [
          {
            invocation_id: 'call-search-1',
            agent_id: 0,
            agent_label: 'AGENT 1',
            tool_name: 'search_web',
            arguments: { query: 'latest AI news' },
            duration_ms: 250,
            tool_output: 'Found live sources',
          },
        ],
      });

      expect(ctx.refs.toolEvents).toHaveLength(1);
      expect(ctx.refs.toolEvents[0]).toMatchObject({
        invocationId: 'call-search-1',
        agentId: 0,
        agentLabel: 'AGENT 1',
        toolName: 'search_web',
        durationMs: 250,
        resultPreview: 'Found live sources',
      });
    });

    it('publishes sources from progress tool events', () => {
      const ctx = createMockContext();
      const payload: StreamingPayload = {
        type: 'progress',
        tool_events: [
          {
            tool_name: 'search',
            status: 'completed',
            sources: [{ url: 'https://news.example/article', title: 'News' }],
          },
        ],
      };

      handleStreamingPayload(ctx, payload);

      expect(ctx.refs.sources).toEqual([{ url: 'https://news.example/article', title: 'News' }]);
      expect(ctx.setters.setSources).toHaveBeenCalledWith([
        { url: 'https://news.example/article', title: 'News' },
      ]);
    });

    it('appends single tool_event from progress payload', () => {
      const ctx = createMockContext({
        refs: {
          ...createMockContext().refs,
          toolEvents: [
            {
              agentLabel: 'Agent 1',
              toolName: 'search',
              arguments: {},
              success: true,
              durationMs: 10,
            },
          ],
        },
      });
      const payload: StreamingPayload = {
        type: 'progress',
        tool_event: { tool_name: 'execute_python', status: 'completed' },
      };
      handleStreamingPayload(ctx, payload);
      expect(ctx.refs.toolEvents).toHaveLength(2);
      expect(ctx.setters.setToolEvents).toHaveBeenCalled();
    });
  });

  describe('tool payload', () => {
    it('normalizes tool_events array', () => {
      const ctx = createMockContext({
        refs: {
          ...createMockContext().refs,
          toolEvents: [
            {
              timestamp: '2026-01-01T00:00:00.000Z',
              agentLabel: 'Agent 1',
              toolName: 'search',
              arguments: {},
              success: true,
              durationMs: 1,
            },
          ],
        },
      });
      const toolEvents = [{ tool_call_id: '1', tool_name: 'search', status: 'running' }];
      const payload: StreamingPayload = { type: 'tool', tool_events: toolEvents };
      handleStreamingPayload(ctx, payload);
      expect(ctx.refs.toolEvents).toHaveLength(2);
      expect(ctx.setters.setToolEvents).toHaveBeenCalled();
    });

    it('normalizes single tool_event', () => {
      const ctx = createMockContext();
      const toolEvent = { tool_call_id: '1', tool_name: 'search', status: 'running' };
      const payload: StreamingPayload = { type: 'tool', tool_event: toolEvent };
      handleStreamingPayload(ctx, payload);
      expect(ctx.refs.toolEvents).toHaveLength(1);
    });
  });

  describe('complete payload', () => {
    it('sets final response and stream content from message', () => {
      const ctx = createMockContext();
      const payload: StreamingPayload = { type: 'complete', message: 'Final answer' };
      handleStreamingPayload(ctx, payload);
      expect(ctx.setters.setFinalResponse).toHaveBeenCalledWith('Final answer');
      expect(ctx.setters.setStreamContent).toHaveBeenCalledWith('Final answer');
    });

    it('publishes final execution details before final response persistence is triggered', () => {
      const order: string[] = [];
      const ctx = createMockContext({
        setters: {
          ...createMockSetters(),
          setAgentStatuses: vi.fn(() => order.push('agentStatuses')),
          setToolEvents: vi.fn(() => order.push('toolEvents')),
          setTraceId: vi.fn(() => order.push('traceId')),
          setFinalResponse: vi.fn(() => order.push('finalResponse')),
        },
        state: {
          ...createMockContext().state,
          agentStatuses: [{ agent_id: 0, status: 'RUNNING', progress: 0.4 }],
        } as StreamingState,
      });
      const payload: StreamingPayload = {
        type: 'complete',
        message: 'Final answer',
        trace_id: 'task-1',
        agent_statuses: [{ agent_id: 0, status: 'COMPLETED', progress: 1, model: 'model-a' }],
        tool_usage: [{ tool_name: 'search', status: 'completed' }],
      };

      handleStreamingPayload(ctx, payload);

      expect(order.indexOf('traceId')).toBeLessThan(order.indexOf('finalResponse'));
      expect(order.indexOf('toolEvents')).toBeLessThan(order.indexOf('finalResponse'));
      expect(order.indexOf('agentStatuses')).toBeLessThan(order.indexOf('finalResponse'));
    });

    it('calls onConversationId when conversation_id provided', () => {
      const ctx = createMockContext();
      const payload: StreamingPayload = { type: 'complete', conversation_id: 123 };
      handleStreamingPayload(ctx, payload);
      expect(ctx.setters.onConversationId).toHaveBeenCalledWith(123);
    });

    it('sets trace_id when provided', () => {
      const ctx = createMockContext();
      const payload: StreamingPayload = { type: 'complete', trace_id: 'trace-123' };
      handleStreamingPayload(ctx, payload);
      expect(ctx.setters.setTraceId).toHaveBeenCalledWith('trace-123');
    });

    it('sets final reasoning when accumulated', () => {
      const ctx = createMockContext({
        refs: { ...createMockContext().refs, reasoning: 'My reasoning' },
      });
      const payload: StreamingPayload = { type: 'complete' };
      handleStreamingPayload(ctx, payload);
      expect(ctx.setters.setFinalReasoning).toHaveBeenCalledWith('My reasoning');
    });

    it('completes agent statuses', () => {
      const ctx = createMockContext({
        state: {
          ...createMockContext().state,
          agentStatuses: [{ agent_id: 0, status: 'RUNNING', progress: 0.5 }],
        },
      });
      const payload: StreamingPayload = { type: 'complete' };
      handleStreamingPayload(ctx, payload);
      expect(ctx.setters.setAgentStatuses).toHaveBeenCalledWith([
        { agent_id: 0, status: 'COMPLETED', progress: 1 },
      ]);
    });

    it('uses server-provided final agent statuses when present', () => {
      const ctx = createMockContext({
        state: {
          ...createMockContext().state,
          agentStatuses: [{ agent_id: 0, status: 'RUNNING', progress: 0.5 }],
        },
      });
      const payload: StreamingPayload = {
        type: 'complete',
        agent_statuses: [{ agent_id: 0, status: 'FAILED', progress: 1 }],
      };
      handleStreamingPayload(ctx, payload);
      expect(ctx.setters.setAgentStatuses).toHaveBeenCalledWith([
        { agent_id: 0, status: 'FAILED', progress: 1 },
      ]);
    });

    it('persists launch labels in final agent statuses when backend omits model names', () => {
      const ctx = createMockContext({
        state: {
          ...createMockContext().state,
          agentStatuses: [
            { agent_id: 0, status: 'RUNNING', progress: 0.5 },
            { agent_id: 1, status: 'RUNNING', progress: 0.4 },
          ],
        } as StreamingState,
        refs: { ...createMockContext().refs, agentCount: 2, agentLabels: ['gpt-5.5', 'grok-4.3'] },
      });

      handleStreamingPayload(ctx, {
        type: 'complete',
        agent_statuses: [
          { agent_id: 0, status: 'COMPLETED', progress: 1 },
          { agent_id: 1, status: 'COMPLETED', progress: 1 },
        ],
      });

      expect(ctx.setters.setAgentStatuses).toHaveBeenCalledWith([
        { agent_id: 0, status: 'COMPLETED', progress: 1, model: 'gpt-5.5' },
        { agent_id: 1, status: 'COMPLETED', progress: 1, model: 'grok-4.3' },
      ]);
    });

    it('merges final agent statuses with live model labels and results', () => {
      const ctx = createMockContext({
        state: {
          ...createMockContext().state,
          agentStatuses: [
            {
              agent_id: 0,
              status: 'PROCESSING...',
              progress: 0.6,
              model: 'model-research',
              result: 'live result',
            },
            { agent_id: 1, status: 'PROCESSING...', progress: 0.4, model: 'model-analysis' },
          ],
        } as StreamingState,
        refs: { ...createMockContext().refs, agentCount: 2 },
      });

      const payload: StreamingPayload = {
        type: 'complete',
        agent_statuses: [
          { agent_id: 0, status: 'COMPLETED', progress: 1 },
          { agent_id: 1, status: 'COMPLETED', progress: 1, result: 'final result' },
        ],
      };

      handleStreamingPayload(ctx, payload);

      expect(ctx.setters.setAgentStatuses).toHaveBeenCalledWith([
        {
          agent_id: 0,
          status: 'COMPLETED',
          progress: 1,
          model: 'model-research',
          result: 'live result',
        },
        {
          agent_id: 1,
          status: 'COMPLETED',
          progress: 1,
          model: 'model-analysis',
          result: 'final result',
        },
      ]);
    });

    it('merges final tool usage and publishes search sources', () => {
      const ctx = createMockContext({
        refs: {
          ...createMockContext().refs,
          toolEvents: [
            {
              timestamp: '2026-01-01T00:00:00.000Z',
              agentLabel: 'Agent 1',
              toolName: 'search',
              arguments: {},
              success: true,
              durationMs: 10,
            },
          ],
        },
      });

      const payload: StreamingPayload = {
        type: 'complete',
        message: 'Done',
        tool_usage: [
          {
            timestamp: '2026-01-01T00:00:01.000Z',
            agent_label: 'Agent 2',
            tool_name: 'search',
            status: 'completed',
            sources: [{ url: 'https://source.example', title: 'Source' }],
          },
        ],
      };

      handleStreamingPayload(ctx, payload);

      expect(ctx.refs.toolEvents).toHaveLength(2);
      expect(ctx.setters.setFinalToolEvents).toHaveBeenCalledWith(ctx.refs.toolEvents);
      expect(ctx.refs.sources).toEqual([{ url: 'https://source.example', title: 'Source' }]);
      expect(ctx.setters.setFinalSources).toHaveBeenCalledWith([
        { url: 'https://source.example', title: 'Source' },
      ]);
    });

    it('preserves failed statuses when complete payload omits final statuses', () => {
      const ctx = createMockContext({
        state: {
          ...createMockContext().state,
          agentStatuses: [{ agent_id: 0, status: 'FAILED', progress: 1 }],
        },
      });
      const payload: StreamingPayload = { type: 'complete' };
      handleStreamingPayload(ctx, payload);
      expect(ctx.setters.setAgentStatuses).toHaveBeenCalledWith([
        { agent_id: 0, status: 'FAILED', progress: 1 },
      ]);
    });

    it('closes stream with complete reason', () => {
      const ctx = createMockContext();
      const payload: StreamingPayload = { type: 'complete' };
      handleStreamingPayload(ctx, payload);
      expect(ctx.setters.closeStream).toHaveBeenCalledWith('complete');
      expect(ctx.setters.setIsStreaming).toHaveBeenCalledWith(false);
    });
  });

  describe('error payload', () => {
    it('sets error message', () => {
      const ctx = createMockContext();
      const payload: StreamingPayload = { type: 'error', error: 'Something went wrong' };
      handleStreamingPayload(ctx, payload);
      expect(ctx.setters.setErrorMessage).toHaveBeenCalledWith('Something went wrong');
    });

    it('resets all state', () => {
      const ctx = createMockContext({
        refs: {
          ...createMockContext().refs,
          sources: [{ url: 'test' }],
          toolEvents: [
            {
              agentLabel: 'agent',
              toolName: 'search',
              arguments: {},
              success: true,
              durationMs: 100,
            },
          ],
          reasoning: 'old reasoning',
        },
      });
      const payload: StreamingPayload = { type: 'error', error: 'Failed' };
      handleStreamingPayload(ctx, payload);
      expect(ctx.refs.sources).toEqual([]);
      expect(ctx.refs.toolEvents).toEqual([]);
      expect(ctx.refs.reasoning).toBe('');
      expect(ctx.setters.setFinalSources).toHaveBeenCalledWith([]);
      expect(ctx.setters.setFinalToolEvents).toHaveBeenCalledWith([]);
      expect(ctx.setters.setFinalReasoning).toHaveBeenCalledWith(null);
    });

    it('closes stream with error reason', () => {
      const ctx = createMockContext();
      const payload: StreamingPayload = { type: 'error', error: 'Failed' };
      handleStreamingPayload(ctx, payload);
      expect(ctx.setters.closeStream).toHaveBeenCalledWith('error');
      expect(ctx.setters.setIsStreaming).toHaveBeenCalledWith(false);
    });

    it('clears model info', () => {
      const ctx = createMockContext();
      const payload: StreamingPayload = { type: 'error', error: 'Failed' };
      handleStreamingPayload(ctx, payload);
      expect(ctx.setters.setModelId).toHaveBeenCalledWith(null);
      expect(ctx.setters.setModelLabel).toHaveBeenCalledWith(null);
      expect(ctx.setters.setModelBadge).toHaveBeenCalledWith(null);
    });
  });

  describe('unknown payload type', () => {
    it('logs debug message for unhandled types', () => {
      const ctx = createMockContext({ debug: true });
      const payload = { type: 'unknown' } as StreamingPayload;
      handleStreamingPayload(ctx, payload);
      expect(ctx.logger.debug).toHaveBeenCalledWith('[StreamingEngine] Unhandled message type', {
        type: 'unknown',
      });
    });
  });
});
