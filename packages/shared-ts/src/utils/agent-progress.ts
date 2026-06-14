import { getPublicModelLabel } from '../chat/model-catalog';

export type AgentProgressState = 'queued' | 'running' | 'completed' | 'failed';

export interface AgentProgress {
  progress: number;
  label: string;
  state: AgentProgressState;
}

export interface AgentStatusLike {
  agent_id?: number;
  status?: string;
  progress?: number;
  result?: string;
  reasoning?: string;
  model?: string;
}

export interface AgentVisualizationData {
  id: number;
  label: string;
  status: string;
  displayStatus: string;
  progressValue: number;
  result?: string;
  reasoning?: string;
  state: AgentProgressState;
  model?: string;
}

export interface ToolUsageEventLike {
  toolName?: string;
}

export interface ExecutionDisplayViewModel<
  TAgent extends AgentVisualizationData = AgentVisualizationData,
  TToolEvent extends ToolUsageEventLike = ToolUsageEventLike,
> {
  agents: TAgent[];
  overallProgress: number;
  indicatorState: AgentProgressState;
  runningCount: number;
  runningAgentLabel?: string;
  headerText: string;
  resolvedModelLabel: string;
  elapsedLabel: string;
  progressWidth: string;
  toolEvents: TToolEvent[];
  hasToolEvents: boolean;
  hasComputerUseEvents: boolean;
  shouldShowComputerTheater: boolean;
}

export const clamp = (value: number, min = 0, max = 1): number => {
  return Math.min(Math.max(value, min), max);
};

export const formatElapsed = (seconds: number): string => {
  if (seconds <= 0) {
    return '0s';
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes === 0) {
    return `${remainingSeconds}s`;
  }
  return `${minutes}m ${remainingSeconds.toString().padStart(2, '0')}s`;
};

const titleCase = (input: string): string =>
  input
    .toLowerCase()
    .split(' ')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

export const parseAgentProgress = (status: string, explicit?: number): AgentProgress => {
  const normalized = status.trim();
  const upper = normalized.toUpperCase();

  let state: AgentProgressState = 'running';
  if (upper.includes('FAIL') || upper === 'ERROR') {
    state = 'failed';
  } else if (
    upper === 'COMPLETED' ||
    upper === 'COMPLETE' ||
    upper === 'DONE' ||
    upper === 'SUCCESS'
  ) {
    state = 'completed';
  } else if (upper.includes('QUEUE') || upper.includes('WAIT')) {
    state = 'queued';
  }

  if (typeof explicit === 'number' && Number.isFinite(explicit)) {
    const clamped = clamp(explicit);
    return {
      progress: clamped,
      label: `${Math.round(clamped * 100)}%`,
      state: clamped >= 1 ? 'completed' : state,
    };
  }

  if (normalized.toUpperCase().startsWith('PROGRESS:')) {
    const raw = parseFloat(normalized.split(':')[1] ?? '0');
    const fraction = clamp(Number.isFinite(raw) ? raw : 0);
    return {
      progress: fraction,
      label: `${Math.round(fraction * 100)}%`,
      state: fraction >= 1 ? 'completed' : state,
    };
  }

  if (state === 'failed') {
    return { progress: 1, label: 'Failed', state: 'failed' };
  }
  if (state === 'completed') {
    return { progress: 1, label: 'Completed', state: 'completed' };
  }
  if (upper.includes('PROCESS')) {
    return { progress: 0.6, label: 'Processing', state: 'running' };
  }
  if (upper.includes('INITIAL')) {
    return { progress: 0.3, label: 'Initializing', state: 'running' };
  }
  if (state === 'queued') {
    return { progress: 0.05, label: 'Queued', state: 'queued' };
  }
  if (upper.includes('RUNNING') || upper.includes('WORK')) {
    return { progress: 0.5, label: 'Running', state: 'running' };
  }

  return { progress: 0.4, label: titleCase(normalized || 'Queued'), state: 'running' };
};

/**
 * Computes the overall progress percentage (0 to 1) for a set of agents.
 */
export const computeOverallProgress = (
  agents: Array<{ progressValue: number }>,
  isCompletedSnapshot = false
): number => {
  if (isCompletedSnapshot) {
    return 1;
  }
  const count = agents.length;
  if (count === 0) {
    return 0;
  }
  const total = agents.reduce((sum, agent) => sum + agent.progressValue, 0);
  return clamp(total / count);
};

export const estimateStreamingProgress = (
  reportedProgress: number,
  elapsedSeconds: number,
  state: AgentProgressState
): number => {
  if (state === 'completed' || state === 'failed') {
    return clamp(reportedProgress);
  }

  const floor = clamp(reportedProgress);
  const elapsed = Math.max(0, elapsedSeconds);
  const activeState = state === 'queued' && elapsed >= 8 ? 'running' : state;
  const cap = activeState === 'queued' ? 0.32 : 0.94;
  const baseline = Math.max(floor, 0.05);
  const eased = cap - (cap - baseline) * Math.exp(-elapsed / 36);
  return clamp(Math.max(floor, eased), 0, cap);
};

export const smoothStreamingAgentProgress = <TAgent extends AgentVisualizationData>(
  agent: TAgent,
  elapsedSeconds: number,
  isStreaming: boolean
): TAgent => {
  if (!isStreaming || agent.state === 'completed' || agent.state === 'failed') {
    return agent;
  }

  const progressValue = estimateStreamingProgress(agent.progressValue, elapsedSeconds, agent.state);
  const state = progressValue > 0.08 ? 'running' : agent.state;

  return {
    ...agent,
    progressValue,
    state,
    displayStatus: `${Math.round(progressValue * 100)}%`,
  };
};

/**
 * Derives the overall indicator state based on the states of individual agents.
 */
export const deriveIndicatorState = (
  agents: Array<{ state: AgentProgressState }>,
  isCompletedSnapshot = false,
  isStreaming = false
): AgentProgressState => {
  if (isCompletedSnapshot) {
    return 'completed';
  }
  if (!isStreaming) {
    return 'completed';
  }
  if (agents.some((agent) => agent.state === 'failed')) {
    return 'failed';
  }
  if (agents.length > 0 && agents.every((agent) => agent.state === 'completed')) {
    return isStreaming ? 'running' : 'completed';
  }
  if (agents.some((agent) => agent.state === 'running')) {
    return 'running';
  }
  return 'queued';
};

export const createAgentVisualization = (
  status: AgentStatusLike,
  fallbackIndex: number,
  options: {
    labelPrefix?: string;
    uppercaseLabel?: boolean;
  } = {}
): AgentVisualizationData => {
  const id = typeof status.agent_id === 'number' ? status.agent_id : fallbackIndex;
  const rawStatus = status.status ?? 'QUEUED';
  const { progress, label, state } = parseAgentProgress(rawStatus, status.progress);
  const displayLabel = `${options.labelPrefix ?? 'Agent'} ${id + 1}`;
  const visualization: AgentVisualizationData = {
    id,
    label: options.uppercaseLabel ? displayLabel.toUpperCase() : displayLabel,
    status: rawStatus,
    displayStatus: label,
    progressValue: progress,
    state,
  };
  if (status.result !== undefined) {
    visualization.result = status.result;
  }
  if (status.reasoning !== undefined) {
    visualization.reasoning = status.reasoning;
  }
  if (status.model !== undefined) {
    visualization.model = getPublicModelLabel(status.model) ?? status.model;
  }
  return visualization;
};

export const buildAgentVisualizations = (
  statuses?: AgentStatusLike[],
  options: {
    labelPrefix?: string;
    uppercaseLabel?: boolean;
  } = {}
): AgentVisualizationData[] =>
  (statuses ?? [])
    .map((status, index) => createAgentVisualization(status, index, options))
    .sort((a, b) => a.id - b.id);

export const resolveAgentStateLabel = (agent: { state: AgentProgressState }): string => {
  if (agent.state === 'failed') {
    return 'Failed';
  }
  if (agent.state === 'completed') {
    return 'Completed';
  }
  if (agent.state === 'running') {
    return 'In progress';
  }
  return 'Queued';
};

export const splitAgentResultLines = (result?: string): string[] => {
  if (!result) {
    return [];
  }
  return result
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
};

export const resolveExecutionAgentVisualizations = (options: {
  isStreaming: boolean;
  streamingStatuses?: AgentStatusLike[];
  storedStatuses?: AgentStatusLike[];
  replayStatuses?: AgentStatusLike[];
  uppercaseLabel?: boolean;
}): AgentVisualizationData[] => {
  if (options.replayStatuses) {
    return buildAgentVisualizations(options.replayStatuses, {
      uppercaseLabel: options.uppercaseLabel,
    });
  }

  if (!options.isStreaming && options.storedStatuses && options.storedStatuses.length > 0) {
    return buildAgentVisualizations(options.storedStatuses, {
      uppercaseLabel: options.uppercaseLabel,
    });
  }

  return buildAgentVisualizations(options.streamingStatuses, {
    uppercaseLabel: options.uppercaseLabel,
  });
};

export const resolveExecutionToolEvents = <TToolEvent>(options: {
  isStreaming: boolean;
  streamingEvents?: TToolEvent[];
  storedEvents?: TToolEvent[];
  finalEvents?: TToolEvent[];
  replayEvents?: TToolEvent[];
}): TToolEvent[] => {
  if (options.replayEvents) {
    return options.replayEvents;
  }
  if (options.isStreaming) {
    return options.streamingEvents ?? [];
  }
  if (options.storedEvents && options.storedEvents.length > 0) {
    return options.storedEvents;
  }
  return options.finalEvents ?? [];
};

export const resolveExecutionReasoning = (options: {
  isStreaming: boolean;
  streamingReasoning?: string | null;
  storedReasoning?: string | null;
  finalReasoning?: string | null;
  replayReasoning?: string | null;
}): string | undefined => {
  if (options.replayReasoning !== undefined && options.replayReasoning !== null) {
    return options.replayReasoning;
  }
  if (options.isStreaming) {
    return options.streamingReasoning || undefined;
  }
  return options.storedReasoning || options.finalReasoning || undefined;
};

const resolveModelLabelFromAgents = (agents: Array<{ model?: string }>): string | undefined => {
  const models = Array.from(
    new Set(
      agents
        .map((agent) => getPublicModelLabel(agent.model))
        .filter((model): model is string => Boolean(model))
    )
  );
  if (models.length === 0) {
    return undefined;
  }
  if (models.length <= 2) {
    return models.join(' + ');
  }
  return `${models[0]} + ${models.length - 1} more`;
};

export const createExecutionDisplayViewModel = <
  TAgent extends AgentVisualizationData,
  TToolEvent extends ToolUsageEventLike,
>(options: {
  agents: TAgent[];
  elapsedSeconds: number;
  modelLabel?: string | null;
  defaultModelLabel?: string;
  isStreaming?: boolean;
  isCompletedSnapshot?: boolean;
  toolEvents?: TToolEvent[];
  computerUseEnabled?: boolean;
}): ExecutionDisplayViewModel<TAgent, TToolEvent> => {
  const agents = options.agents;
  const toolEvents = options.toolEvents ?? [];
  const isStreaming = options.isStreaming ?? false;
  const isCompletedSnapshot = options.isCompletedSnapshot ?? false;
  const overallProgress = computeOverallProgress(agents, isCompletedSnapshot);
  const indicatorState = deriveIndicatorState(agents, isCompletedSnapshot, isStreaming);
  const isSynthesizingAnswer =
    isStreaming &&
    !isCompletedSnapshot &&
    agents.length > 0 &&
    agents.every((agent) => agent.state === 'completed');
  const runningCount = agents.filter((agent) => agent.state === 'running').length;
  const runningAgentLabel = agents.find((agent) => agent.state === 'running')?.label;
  const hasComputerUseEvents = toolEvents.some((event) => event.toolName === 'computer_use');
  const modelLabel =
    resolveModelLabelFromAgents(agents) ??
    options.modelLabel ??
    options.defaultModelLabel ??
    'Heavy';

  return {
    agents,
    overallProgress,
    indicatorState,
    runningCount,
    runningAgentLabel,
    headerText: isSynthesizingAnswer
      ? 'Synthesizing Answer'
      : indicatorState === 'completed'
        ? 'Completed'
        : 'Agents Working',
    resolvedModelLabel: modelLabel.toUpperCase(),
    elapsedLabel: formatElapsed(options.elapsedSeconds),
    progressWidth: `${(overallProgress * 100).toFixed(1)}%`,
    toolEvents,
    hasToolEvents: toolEvents.length > 0,
    hasComputerUseEvents,
    shouldShowComputerTheater:
      hasComputerUseEvents || Boolean(options.computerUseEnabled && isStreaming),
  };
};
