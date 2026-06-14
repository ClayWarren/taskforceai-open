import {
  resolveAgentStateLabel,
  splitAgentResultLines,
} from '@taskforceai/shared/utils/agent-progress';
import { getPublicModelLabel } from '@taskforceai/shared/chat/model-catalog';

import type { SourceReference, ToolUsageEvent } from '../../lib/types';
import ToolUsageList from './ToolUsageList';
import type { AgentVisualization } from './AgentExpandedView';
import {
  describeRunningAgentActivity,
  statusBadgeClass,
  toAgentStatusId,
} from './AgentExpandedPanels';
import { summarizeGeneratedMediaResult } from './generatedMediaResult';

const latestToolActivityText = (events: ToolUsageEvent[]): string | null => {
  const latest = events.at(-1);
  if (!latest) {
    return null;
  }

  const toolName = latest.toolName || 'tool';
  if (latest.error) {
    return `Latest tool: ${toolName} reported an error.`;
  }
  if (latest.resultPreview) {
    return `Latest tool: ${toolName} returned results.`;
  }
  return `Latest tool: ${toolName} is running.`;
};

const displayAgentModel = (model?: string): string | undefined => {
  const trimmed = model?.trim();
  if (!trimmed) {
    return undefined;
  }
  return getPublicModelLabel(trimmed);
};

interface AgentDetailProps {
  agent: AgentVisualization;
  events: ToolUsageEvent[];
  reasoning?: string;
  searchInteractive?: boolean;
  onBack: () => void;
  onShowSources?: (sources: SourceReference[]) => void;
}

export function AgentDetail({
  agent,
  events,
  reasoning,
  searchInteractive,
  onBack,
  onShowSources,
}: AgentDetailProps) {
  const statusId = toAgentStatusId(agent);
  const latestToolText = latestToolActivityText(events);
  const displayLabel = displayAgentModel(agent.model) || agent.label;
  const secondaryLabel = agent.model ? agent.label : null;
  const generatedMediaSummary = summarizeGeneratedMediaResult(agent.result);

  return (
    <div
      className="agent-execution-agent-detail flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4"
      role="region"
      aria-label={`${displayLabel} detail`}
    >
      <div className="agent-execution-agent-detail-header flex items-start justify-between gap-3">
        <div className="agent-execution-agent-detail-meta flex flex-col gap-1">
          <span className="agent-execution-agent-label text-sm font-semibold text-slate-100">
            {displayLabel}
          </span>
          {secondaryLabel && (
            <span className="text-xs font-medium text-slate-500 uppercase">{secondaryLabel}</span>
          )}
          <span className={statusBadgeClass(agent.state)}>{agent.displayStatus}</span>
        </div>
        <button
          type="button"
          className="agent-execution-back text-sm font-semibold text-blue-400 transition hover:text-blue-300"
          onClick={onBack}
        >
          Back to agents
        </button>
      </div>
      <div
        className="agent-execution-progress-track h-2 w-full rounded-full bg-slate-800"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(agent.progressValue * 100)}
        aria-label={`${displayLabel} progress`}
        aria-describedby={statusId}
      >
        <div
          className={`agent-execution-progress-fill agent-execution-progress-fill--${agent.state} h-full rounded-full transition-[width,background-color] duration-200 ease-out`}
          style={{ width: `${(agent.progressValue * 100).toFixed(1)}%` }}
        />
      </div>
      <p className="agent-execution-agent-state text-sm text-slate-300" id={statusId}>
        {resolveAgentStateLabel(agent)}
      </p>
      <div
        className="agent-execution-agent-log rounded-lg border border-slate-800 bg-slate-900/60 p-3"
        aria-live="polite"
      >
        {generatedMediaSummary ? (
          <p className="agent-execution-agent-placeholder text-sm text-slate-300">
            {generatedMediaSummary}
          </p>
        ) : agent.result ? (
          <ul className="space-y-1 text-sm leading-relaxed text-slate-100">
            {splitAgentResultLines(agent.result).map((line, index) => (
              <li key={`${agent.id}-line-${index}-${line}`}>{line}</li>
            ))}
          </ul>
        ) : latestToolText ? (
          <p className="agent-execution-agent-placeholder text-sm text-slate-300">
            {latestToolText}
          </p>
        ) : agent.state === 'running' ? (
          <p className="agent-execution-agent-placeholder text-sm text-slate-400">
            {displayLabel} is {describeRunningAgentActivity(agent).toLowerCase()}
          </p>
        ) : (
          <p className="agent-execution-agent-placeholder text-sm text-slate-400">
            Waiting for {displayLabel} to start...
          </p>
        )}
      </div>
      {(agent.reasoning || reasoning) && (
        <div className="agent-execution-reasoning rounded-lg border border-purple-500/30 bg-purple-950/30 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-purple-300">
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
              />
            </svg>
            Thinking
          </div>
          <div className="custom-scrollbar max-h-[500px] min-h-[80px] overflow-y-auto pr-2 font-mono text-sm leading-relaxed whitespace-pre-wrap text-purple-100/80">
            {agent.reasoning || reasoning}
          </div>
        </div>
      )}
      <ToolUsageList
        events={events}
        searchInteractive={Boolean(searchInteractive)}
        {...(onShowSources ? { onShowSources } : {})}
      />
    </div>
  );
}
