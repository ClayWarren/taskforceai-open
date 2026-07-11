import type {
  AgentStatusSnapshot,
  PendingApproval,
  SourceReference,
  ToolUsageEvent,
} from '../types';
import type { LoggerPort } from '../ports/logger';
import { sortedCopy } from '../utils/collection';
import { definedProps } from '../utils/object';
import { extractSourcesFromText, mergeSources } from '../utils/source-extraction';
import { normalizeToolUsageEvent, normalizeToolUsageEvents } from './normalization';
import type { StreamingState, StreamSettlement } from './state';
import type { StreamingPayload } from './types';

export type StreamingLogger = LoggerPort;

export type StreamingSetters = {
  setModelId: (_value: string | null) => void;
  setModelLabel: (_value: string | null) => void;
  setModelBadge: (_value: string | null) => void;
  setAgentStatuses: (_value: AgentStatusSnapshot[]) => void;
  setSources: (_value: SourceReference[]) => void;
  setFinalSources: (_value: SourceReference[]) => void;
  setToolEvents: (_value: ToolUsageEvent[]) => void;
  setFinalToolEvents: (_value: ToolUsageEvent[]) => void;
  setReasoning: (_value: string) => void;
  setFinalReasoning: (_value: string | null) => void;
  setFinalResponse: (_value: string | null) => void;
  setStreamContent: (_value: string) => void;
  setTraceId: (_value: string | null) => void;
  setPendingApproval: (_value: PendingApproval | null) => void;
  setElapsedSeconds: (_value: number) => void;
  setIsStreaming: (_value: boolean) => void;
  setErrorMessage: (_message: string, _resetTime?: string) => void;
  setCurrentSpend: (_value: number) => void;
  closeStream: (_reason: StreamSettlement) => void;
  onConversationId?: (_conversationId: number) => void;
  onApproval?: (approval: PendingApproval | null) => void;
};

export type StreamingEngineContext = {
  state: StreamingState;
  setters: StreamingSetters;
  // Use separate refs for high-frequency updates that don't need to trigger immediate state changes in some implementations
  // but for Zustand we can often just use the state directly.
  // To keep it generic, we'll pass these as mutable objects.
  refs: {
    sources: SourceReference[];
    toolEvents: ToolUsageEvent[];
    reasoning: string;
    agentCount: number | null;
    agentLabels?: string[];
    streamStartTime: number | null;
    ttftReported: boolean;
  };
  debug: boolean;
  logger: StreamingLogger;
  now: () => number;
  reportLatencyMark?: (name: string, detail?: unknown) => void;
};

function reportStreamingTTFTMark(
  ctx: StreamingEngineContext,
  detail: {
    ttftMs: number;
    hasChunk: boolean;
    hasReasoning: boolean;
  }
): void {
  try {
    ctx.reportLatencyMark?.('streaming.ttft', detail);
  } catch {
    // Optional telemetry must never affect product behavior.
  }
}

const sortedNumbersAscending = (items: number[]): number[] => sortedCopy(items, (a, b) => a - b);

const sortedEntriesByKey = (entries: [string, unknown][]): [string, unknown][] =>
  sortedCopy(entries, ([left], [right]) => left.localeCompare(right));

const mergeAgentStatuses = (
  previous: AgentStatusSnapshot[],
  incoming: AgentStatusSnapshot[],
  expectedCount?: number | null
): AgentStatusSnapshot[] => {
  const byId = new Map<number, AgentStatusSnapshot>();
  const order: number[] = [];

  const remember = (id: number, status: AgentStatusSnapshot) => {
    if (!byId.has(id)) {
      order.push(id);
    }
    byId.set(id, status);
  };

  previous.forEach((status, index) => {
    remember(status.agent_id ?? index, status);
  });

  incoming.forEach((status, index) => {
    const id = status.agent_id ?? index;
    const existing = byId.get(id);
    const { progress: existingProgress, ...existingRest } = existing ?? {};
    const { progress: statusProgress, ...statusRest } = status;
    const merged: AgentStatusSnapshot = {
      ...existingRest,
      ...statusRest,
      agent_id: id,
      ...definedProps({ progress: statusProgress ?? existingProgress }),
    };
    const model = status.model || existing?.model;
    const result = status.result || existing?.result;
    const reasoning = status.reasoning || existing?.reasoning;
    if (model) {
      merged.model = model;
    }
    if (result) {
      merged.result = result;
    }
    if (reasoning) {
      merged.reasoning = reasoning;
    }
    remember(id, merged);
  });

  const count = Math.max(expectedCount ?? 0, previous.length, incoming.length);
  for (let id = 0; id < count; id++) {
    if (!byId.has(id)) {
      remember(id, { agent_id: id, status: 'QUEUED', progress: 0.05 });
    }
  }

  return sortedNumbersAscending(order)
    .map((id) => byId.get(id))
    .filter((status): status is AgentStatusSnapshot => Boolean(status));
};

const withAgentLabels = (
  statuses: AgentStatusSnapshot[],
  labels?: string[]
): AgentStatusSnapshot[] => {
  if (!labels || labels.length === 0) {
    return statuses;
  }
  return statuses.map((status, index) => {
    const id = status.agent_id ?? index;
    const label = labels[id] ?? labels[index];
    if (!label) {
      return status;
    }
    return { ...status, model: label };
  });
};

const isFailureStatus = (status: string): boolean =>
  /FAIL|ERROR|ABORT|CANCEL|DENY|TIMEOUT/i.test(status);

const completeMergedAgentStatuses = (statuses: AgentStatusSnapshot[]): AgentStatusSnapshot[] =>
  statuses.map((status) => ({
    ...status,
    status: isFailureStatus(status.status) ? status.status : 'COMPLETED',
    progress: isFailureStatus(status.status) ? (status.progress ?? 1) : 1,
  }));

const mergeToolEvents = (
  previous: ToolUsageEvent[],
  incoming: ToolUsageEvent[]
): ToolUsageEvent[] => {
  const merged = [...previous];
  const shouldIndex =
    previous.length * incoming.length > 10_000 ||
    previous.some((event) => !event.invocationId) ||
    incoming.some((event) => !event.invocationId);

  if (!shouldIndex) {
    for (const event of incoming) {
      const incomingInvocationKey = toolEventInvocationKey(event);
      const existingIndex = merged.findIndex(
        (existing) => toolEventInvocationKey(existing) === incomingInvocationKey
      );
      if (existingIndex >= 0) {
        merged[existingIndex] = { ...merged[existingIndex], ...event };
        continue;
      }
      merged.push(event);
    }
    return merged;
  }

  const indexByInvocationKey = new Map<string, number>();

  for (let index = 0; index < merged.length; index += 1) {
    const event = merged[index]!;
    const invocationKey = toolEventInvocationKey(event);
    if (!indexByInvocationKey.has(invocationKey)) {
      indexByInvocationKey.set(invocationKey, index);
    }
  }

  for (const event of incoming) {
    const incomingInvocationKey = toolEventInvocationKey(event);
    const existingIndex = indexByInvocationKey.get(incomingInvocationKey);
    if (existingIndex !== undefined) {
      merged[existingIndex] = { ...merged[existingIndex], ...event };
      continue;
    }

    indexByInvocationKey.set(incomingInvocationKey, merged.length);
    merged.push(event);
  }
  return merged;
};

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      sortedEntriesByKey(Object.entries(value)).map(([key, nested]) => [key, stableValue(nested)])
    );
  }
  return value;
};

const stableStringify = (value: unknown): string => {
  try {
    return JSON.stringify(stableValue(value));
  } catch {
    return String(value);
  }
};

const toolEventInvocationKey = (event: ToolUsageEvent): string =>
  event.invocationId ||
  [event.agentId ?? '', event.agentLabel, event.toolName, stableStringify(event.arguments)].join(
    '\u001f'
  );

const extractSourcesFromToolEvents = (events: ToolUsageEvent[]): SourceReference[] =>
  events.flatMap((event) => event.sources ?? []);

const mergeAndPublishSources = (
  ctx: StreamingEngineContext,
  sources: SourceReference[],
  options: { final?: boolean } = {}
): void => {
  if (sources.length === 0) {
    if (options.final) {
      ctx.setters.setFinalSources(ctx.refs.sources);
    }
    return;
  }

  const mergedSources = mergeSources(ctx.refs.sources, sources);
  ctx.refs.sources = mergedSources;
  ctx.setters.setSources(mergedSources);
  if (options.final) {
    ctx.setters.setFinalSources(mergedSources);
  }
};

const SOURCE_SCAN_BOUNDARY_CHARACTERS = new Set(['<', '>', '(', ')', '[', ']', '{', '}', '"', "'"]);

const isSourceScanBoundary = (character: string): boolean =>
  /\s/.test(character) || SOURCE_SCAN_BOUNDARY_CHARACTERS.has(character);

const findCumulativeChunkScanStart = (previousContent: string, nextContent: string): number => {
  if (!previousContent || !nextContent.startsWith(previousContent)) {
    return 0;
  }
  if (nextContent.length <= previousContent.length) {
    return nextContent.length;
  }

  let scanStart = previousContent.length;
  while (scanStart > 0 && !isSourceScanBoundary(nextContent.charAt(scanStart - 1))) {
    scanStart -= 1;
  }
  return scanStart;
};

const extractSourcesFromCumulativeChunk = (
  previousContent: string,
  nextContent?: string | null
): SourceReference[] => {
  if (!nextContent) {
    return [];
  }

  const scanStart = findCumulativeChunkScanStart(previousContent, nextContent);
  if (scanStart >= nextContent.length) {
    return [];
  }
  return extractSourcesFromText(nextContent.slice(scanStart));
};

export function handleStreamingPayload(ctx: StreamingEngineContext, payload: StreamingPayload) {
  if (ctx.debug) {
    ctx.logger.debug('[StreamingEngine] Handling message', { type: payload.type });
  }

  switch (payload.type) {
    case 'start':
      handleStartPayload(payload, ctx);
      return;
    case 'progress':
      handleProgressPayload(payload, ctx);
      return;
    case 'tool':
      handleToolPayload(payload, ctx);
      return;
    case 'complete':
      handleCompletePayload(payload, ctx);
      return;
    case 'error':
      handleErrorPayload(payload, ctx);
      return;
    default:
      ctx.logger.debug('[StreamingEngine] Unhandled message type', { type: payload.type });
  }
}

function handleStartPayload(payload: StreamingPayload, ctx: StreamingEngineContext): void {
  if (payload.model_id) {
    ctx.setters.setModelId(payload.model_id);
  }
  if (payload.model_label) {
    ctx.setters.setModelLabel(payload.model_label);
  }
  if (payload.model_badge) {
    ctx.setters.setModelBadge(payload.model_badge);
  }
  if (typeof payload.agent_count === 'number' && payload.agent_count > 0) {
    const agentCount = Math.max(
      payload.agent_count,
      ctx.refs.agentCount ?? 0,
      ctx.state.agentStatuses.length
    );
    ctx.refs.agentCount = agentCount;
    const queuedStatuses = Array.from({ length: payload.agent_count }, (_unused, index) => ({
      agent_id: index,
      status: 'QUEUED',
      progress: 0,
    }));
    ctx.setters.setAgentStatuses(
      withAgentLabels(
        mergeAgentStatuses(ctx.state.agentStatuses, queuedStatuses, agentCount),
        ctx.refs.agentLabels
      )
    );
    return;
  }
  ctx.refs.agentCount = null;
}

function handleProgressPayload(payload: StreamingPayload, ctx: StreamingEngineContext): void {
  // Report TTFT on first chunk or reasoning
  if (!ctx.refs.ttftReported && (payload.chunk || payload.reasoning) && ctx.refs.streamStartTime) {
    const ttft = ctx.now() - ctx.refs.streamStartTime;
    ctx.refs.ttftReported = true;
    const detail = {
      ttftMs: ttft,
      hasChunk: !!payload.chunk,
      hasReasoning: !!payload.reasoning,
    };
    ctx.logger.info('Streaming Time-to-First-Token (TTFT)', {
      ...detail,
    });
    reportStreamingTTFTMark(ctx, detail);
  }

  if (payload.agent_statuses) {
    ctx.setters.setAgentStatuses(
      withAgentLabels(
        mergeAgentStatuses(ctx.state.agentStatuses, payload.agent_statuses, ctx.refs.agentCount),
        ctx.refs.agentLabels
      )
    );
  }

  const agentSources = (payload.agent_statuses ?? []).flatMap((status) =>
    extractSourcesFromText(status.result)
  );
  const progressSources = [
    ...agentSources,
    ...extractSourcesFromCumulativeChunk(ctx.state.streamContent, payload.chunk),
  ];
  mergeAndPublishSources(ctx, progressSources);

  if (payload.chunk) {
    ctx.setters.setStreamContent(payload.chunk);
  }
  if (payload.reasoning) {
    ctx.refs.reasoning = ctx.refs.reasoning + payload.reasoning;
    ctx.setters.setReasoning(ctx.refs.reasoning);
  }

  let nextToolEvents = ctx.refs.toolEvents;
  if (Array.isArray(payload.tool_events)) {
    nextToolEvents = mergeToolEvents(
      ctx.refs.toolEvents,
      normalizeToolUsageEvents(payload.tool_events, new Date(ctx.now()).toISOString())
    );
  } else if (Array.isArray(payload.tool_usage)) {
    nextToolEvents = mergeToolEvents(
      ctx.refs.toolEvents,
      normalizeToolUsageEvents(payload.tool_usage, new Date(ctx.now()).toISOString())
    );
  } else if (payload.tool_event) {
    nextToolEvents = mergeToolEvents(ctx.refs.toolEvents, [
      normalizeToolUsageEvent(payload.tool_event, new Date(ctx.now()).toISOString()),
    ]);
  }

  if (nextToolEvents !== ctx.refs.toolEvents) {
    ctx.refs.toolEvents = nextToolEvents;
    ctx.setters.setToolEvents(nextToolEvents);
    mergeAndPublishSources(ctx, extractSourcesFromToolEvents(nextToolEvents));
  }

  if (
    payload.budget_usage &&
    typeof payload.budget_usage.consumedUsd === 'number' &&
    Number.isFinite(payload.budget_usage.consumedUsd)
  ) {
    ctx.setters.setCurrentSpend(payload.budget_usage.consumedUsd);
  }

  if ('pending_approval' in payload) {
    const pendingApproval = payload.pending_approval ?? null;
    ctx.setters.setPendingApproval(pendingApproval);
    if (ctx.setters.onApproval) {
      ctx.setters.onApproval(pendingApproval);
    }
  }
}

function handleToolPayload(payload: StreamingPayload, ctx: StreamingEngineContext): void {
  let nextEvents = ctx.refs.toolEvents;
  if (Array.isArray(payload.tool_events)) {
    nextEvents = mergeToolEvents(
      ctx.refs.toolEvents,
      normalizeToolUsageEvents(payload.tool_events, new Date(ctx.now()).toISOString())
    );
  } else if (payload.tool_event) {
    nextEvents = mergeToolEvents(ctx.refs.toolEvents, [
      normalizeToolUsageEvent(payload.tool_event, new Date(ctx.now()).toISOString()),
    ]);
  }

  ctx.refs.toolEvents = nextEvents;
  ctx.setters.setToolEvents(nextEvents);
  mergeAndPublishSources(ctx, extractSourcesFromToolEvents(nextEvents));
}

function handleCompletePayload(payload: StreamingPayload, ctx: StreamingEngineContext): void {
  if (payload.conversation_id && ctx.setters.onConversationId) {
    ctx.setters.onConversationId(payload.conversation_id);
  }

  if (payload.trace_id) {
    ctx.setters.setTraceId(payload.trace_id);
  }

  const completionToolEvents = Array.isArray(payload.tool_usage)
    ? mergeToolEvents(
        ctx.refs.toolEvents,
        normalizeToolUsageEvents(payload.tool_usage, new Date(ctx.now()).toISOString())
      )
    : ctx.refs.toolEvents;
  ctx.refs.toolEvents = completionToolEvents;
  ctx.setters.setToolEvents(completionToolEvents);
  ctx.setters.setFinalToolEvents(completionToolEvents);

  mergeAndPublishSources(
    ctx,
    [
      ...extractSourcesFromToolEvents(completionToolEvents),
      ...extractSourcesFromText(payload.message),
    ],
    { final: true }
  );

  if (ctx.refs.reasoning) {
    ctx.setters.setFinalReasoning(ctx.refs.reasoning);
  }

  ctx.setters.setPendingApproval(null);
  if (ctx.setters.onApproval) {
    ctx.setters.onApproval(null);
  }

  if (Array.isArray(payload.agent_statuses) && payload.agent_statuses.length > 0) {
    const mergedStatuses = mergeAgentStatuses(
      ctx.state.agentStatuses,
      payload.agent_statuses,
      ctx.refs.agentCount
    );
    ctx.setters.setAgentStatuses(
      withAgentLabels(completeMergedAgentStatuses(mergedStatuses), ctx.refs.agentLabels)
    );
  } else if (ctx.state.agentStatuses.length > 0) {
    // Fallback when server omits final statuses: complete non-failed agents, preserve failures.
    ctx.setters.setAgentStatuses(
      withAgentLabels(completeMergedAgentStatuses(ctx.state.agentStatuses), ctx.refs.agentLabels)
    );
  }

  if (ctx.refs.streamStartTime) {
    const elapsed = Math.floor((ctx.now() - ctx.refs.streamStartTime) / 1000);
    ctx.setters.setElapsedSeconds(elapsed);
  }

  if (payload.message) {
    ctx.setters.setStreamContent(payload.message);
    ctx.setters.setFinalResponse(payload.message);
  }

  ctx.refs.agentCount = null;
  ctx.refs.ttftReported = false;
  ctx.setters.setIsStreaming(false);
  ctx.setters.closeStream('complete');
}

function handleErrorPayload(payload: StreamingPayload, ctx: StreamingEngineContext): void {
  if (payload.error) {
    ctx.setters.setErrorMessage(payload.error);
  }
  ctx.refs.sources = [];
  ctx.setters.setSources([]);
  ctx.setters.setFinalSources([]);
  ctx.refs.toolEvents = [];
  ctx.setters.setToolEvents([]);
  ctx.setters.setFinalToolEvents([]);
  ctx.refs.reasoning = '';
  ctx.setters.setReasoning('');
  ctx.setters.setFinalReasoning(null);
  ctx.setters.setPendingApproval(null);
  if (ctx.setters.onApproval) {
    ctx.setters.onApproval(null);
  }
  ctx.refs.ttftReported = false;
  ctx.setters.setModelId(null);
  ctx.setters.setModelLabel(null);
  ctx.setters.setModelBadge(null);
  ctx.setters.setIsStreaming(false);
  ctx.setters.closeStream('error');
}
