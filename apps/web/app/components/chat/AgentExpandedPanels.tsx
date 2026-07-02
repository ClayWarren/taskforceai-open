import {
  formatElapsed,
  resolveAgentStateLabel,
  splitAgentResultLines,
} from '@taskforceai/shared/utils/agent-progress';
import { getPublicModelLabel } from '@taskforceai/shared/chat/model-catalog';

import type { ToolUsageEvent } from '../../lib/types';
import type { AgentVisualization } from './AgentExpandedTypes';
import { summarizeGeneratedMediaResult } from './generatedMediaResult';

export function statusBadgeClass(state: AgentVisualization['state']): string {
  if (state === 'completed') {
    return 'agent-execution-status-badge agent-execution-status-badge--completed bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-500/40';
  }
  if (state === 'failed') {
    return 'agent-execution-status-badge agent-execution-status-badge--failed bg-red-500/15 text-red-200 ring-1 ring-red-500/40';
  }
  if (state === 'running') {
    return 'agent-execution-status-badge agent-execution-status-badge--running bg-amber-400/15 text-amber-100 ring-1 ring-amber-400/40';
  }
  return 'agent-execution-status-badge bg-blue-500/15 text-blue-100 ring-1 ring-blue-500/40';
}

function progressFillClass(state: AgentVisualization['state']): string {
  return `agent-execution-progress-fill agent-execution-progress-fill--${state}`;
}

export function toAgentStatusId(agent: AgentVisualization): string {
  const normalizedLabel = agent.label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `agent-status-${agent.id}-${normalizedLabel || 'unknown'}`;
}

export function describeRunningAgentActivity(agent: AgentVisualization): string {
  if (agent.state !== 'running') {
    return 'No live activity recorded';
  }
  if (agent.progressValue >= 0.78) {
    return 'Synthesizing findings and checking the answer...';
  }
  if (agent.progressValue >= 0.48) {
    return 'Searching, reading, and comparing evidence...';
  }
  if (agent.progressValue >= 0.18) {
    return 'Planning the approach and collecting context...';
  }
  return 'Starting the task and preparing context...';
}

export function describeAgentSummary({
  activeCount,
  agentCount,
  completedCount,
  indicatorState,
}: {
  activeCount: number;
  agentCount: number;
  completedCount: number;
  indicatorState: AgentVisualization['state'];
}): string {
  if (agentCount <= 0) {
    return '';
  }
  if (indicatorState === 'completed') {
    return `${agentCount} agent${agentCount === 1 ? '' : 's'} completed`;
  }
  if (indicatorState === 'running' && completedCount === agentCount) {
    return 'Synthesizing final answer';
  }
  if (indicatorState === 'failed') {
    return 'Agent run failed';
  }
  if (activeCount > 0) {
    return `${activeCount} agent${activeCount === 1 ? '' : 's'} running`;
  }
  return `${agentCount} agent${agentCount === 1 ? '' : 's'} queued`;
}

export function latestLiveAgentLine(agent: AgentVisualization): string | undefined {
  const mediaSummary = summarizeGeneratedMediaResult(agent.result);
  if (mediaSummary) {
    return mediaSummary;
  }

  const lines = [
    ...splitAgentResultLines(agent.reasoning),
    ...splitAgentResultLines(agent.result),
  ].filter((line) => !/^(thinking|in progress|queued|completed)$/i.test(line));
  return lines.at(-1);
}

interface AgentExpandedHeaderProps {
  activeCount: number;
  agentCount: number;
  completedCount: number;
  elapsedSeconds: number;
  headerText: string;
  indicatorState: AgentVisualization['state'];
  modelLabel: string;
  onCollapse: () => void;
}

export function AgentExpandedHeader({
  activeCount,
  agentCount,
  completedCount,
  elapsedSeconds,
  headerText,
  indicatorState,
  modelLabel,
  onCollapse,
}: AgentExpandedHeaderProps) {
  const indicatorClass = `agent-execution-dot agent-execution-dot--${indicatorState} h-2 w-2 rounded-full`;
  const summary = describeAgentSummary({ activeCount, agentCount, completedCount, indicatorState });

  return (
    <div className="agent-execution-header flex flex-col gap-3 border-b border-slate-800 pb-3 md:flex-row md:items-center md:justify-between">
      <div className="agent-execution-header-title flex items-center gap-3 text-sm text-slate-200">
        <span className={indicatorClass} aria-hidden="true"></span>
        <span className="font-semibold tracking-wide text-slate-300 uppercase">{headerText}</span>
        <span className="agent-execution-separator text-slate-500" aria-hidden="true">
          &middot;
        </span>
        <span className="agent-execution-model rounded-full border border-slate-700/80 bg-slate-800/80 px-2 py-0.5 text-xs font-semibold text-slate-100">
          {modelLabel}
        </span>
        <span className="agent-execution-separator text-slate-500" aria-hidden="true">
          &middot;
        </span>
        <span className="agent-execution-timer font-mono text-xs text-slate-400">
          {formatElapsed(elapsedSeconds)}
        </span>
      </div>
      <div className="agent-execution-header-controls flex flex-wrap items-center gap-3 text-sm text-slate-300">
        {summary && (
          <span className="agent-execution-agent-summary rounded-full border border-slate-700/80 bg-slate-800/70 px-3 py-1">
            {summary}
          </span>
        )}
        <button
          type="button"
          className="agent-execution-toggle text-sm font-semibold text-blue-400 transition hover:text-blue-300"
          onClick={onCollapse}
        >
          Collapse
        </button>
      </div>
    </div>
  );
}

interface AgentEmptyStateProps {
  indicatorState: AgentVisualization['state'];
}

export function AgentEmptyState({ indicatorState }: AgentEmptyStateProps) {
  return (
    <div className="agent-execution-agent-placeholder flex flex-1 items-center justify-center rounded-lg border border-dashed border-slate-700 bg-slate-950/50 p-4 text-sm text-slate-400">
      {indicatorState === 'completed'
        ? 'This conversation completed but agent progress data was not saved'
        : 'Agents are spinning up...'}
    </div>
  );
}

interface AgentListProps {
  agents: AgentVisualization[];
  getEventsForAgent: (agent: AgentVisualization) => ToolUsageEvent[];
  onSelectAgent: (agentId: number) => void;
  selectedAgentId: number | null;
}

export function AgentList({
  agents,
  getEventsForAgent,
  onSelectAgent,
  selectedAgentId,
}: AgentListProps) {
  return (
    <div className="agent-execution-agent-list grid gap-3 sm:grid-cols-2" role="list">
      {agents.map((agent) => {
        const toolEvents = getEventsForAgent(agent);
        const toolEventCount = toolEvents.length;
        const latestToolName = toolEvents.at(-1)?.toolName;
        const isSelected = agent.id === selectedAgentId;
        const statusId = toAgentStatusId(agent);
        const modelLabel = getPublicModelLabel(agent.model);
        const primaryLabel = modelLabel || agent.label;
        const secondaryLabel = modelLabel ? agent.label : null;
        const liveActivity = latestLiveAgentLine(agent);
        return (
          <button
            type="button"
            key={`${agent.id}-${agent.label.trim().toLowerCase()}`}
            className={`agent-execution-agent-row flex flex-col gap-2 rounded-xl border p-4 text-left transition focus:ring-2 focus:ring-blue-500/70 focus:outline-none ${
              isSelected
                ? 'border-blue-500/60 bg-blue-500/5'
                : 'border-slate-800 bg-slate-950/60 hover:border-slate-700 hover:bg-slate-900/50'
            }`}
            onClick={() => onSelectAgent(agent.id)}
          >
            <div className="agent-execution-agent-row-header flex items-start justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="agent-execution-agent-label text-sm font-semibold text-slate-100">
                  {primaryLabel}
                </span>
                {secondaryLabel && (
                  <span className="text-[10px] font-medium tracking-wider text-slate-500 uppercase">
                    {secondaryLabel}
                  </span>
                )}
              </div>
              <span className={statusBadgeClass(agent.state)}>{agent.displayStatus}</span>
            </div>
            <div
              className="agent-execution-progress-track agent-execution-progress-track--compact h-1.5 w-full rounded-full bg-slate-800"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(agent.progressValue * 100)}
              aria-label={`${agent.label} progress`}
              aria-describedby={statusId}
              data-testid={`agent-progress-${agent.id}`}
            >
              <div
                className={`${progressFillClass(agent.state)} h-full rounded-full transition-[width,background-color] duration-200 ease-out`}
                style={{ width: `${(agent.progressValue * 100).toFixed(1)}%` }}
                data-testid={`agent-progress-fill-${agent.id}`}
              ></div>
            </div>
            <span className="agent-execution-agent-status text-xs text-slate-400" id={statusId}>
              {resolveAgentStateLabel(agent)}
            </span>
            <div className="agent-execution-agent-tools rounded-lg border border-slate-800 bg-slate-900/40 p-2 text-xs text-slate-300">
              {toolEventCount > 0 ? (
                <span>
                  {toolEventCount} tool call{toolEventCount === 1 ? '' : 's'}
                  {latestToolName ? ` · latest: ${latestToolName}` : ''}
                </span>
              ) : liveActivity ? (
                <span className="line-clamp-2">{liveActivity}</span>
              ) : agent.state === 'running' ? (
                describeRunningAgentActivity(agent)
              ) : agent.state === 'queued' ? (
                'Waiting for the agent to start...'
              ) : (
                'No live activity recorded'
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
