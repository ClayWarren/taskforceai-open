import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  LoaderCircle,
  Pencil,
  Search,
  Terminal,
  Wrench,
} from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';

import { buildToolUsageViewItems } from '@taskforceai/presenters/tool-usage/view-model';
import { resolveExecutionToolEvents } from '@taskforceai/presenters/utils/agent-progress';
import { useStreaming } from '../../lib/providers/StreamingProvider';
import type { AgentStatus, Message, SourceReference, ToolUsageEvent } from '../../lib/types';
import { DiffPreview } from '../tool-usage/DiffPreview';
import { ApprovalCard } from './ApprovalCard';

interface CodeExecutionTimelineProps {
  message: Message;
  onShowSources?: (sources: SourceReference[]) => void;
}

type ActivityKind = 'edit' | 'explore' | 'run' | 'other';

const activityKind = (event: ToolUsageEvent): ActivityKind => {
  const name = event.toolName.trim().toLowerCase();
  if (/(edit|write|patch|create|delete|move|rename)/.test(name)) return 'edit';
  if (/(read|search|find|list|glob|grep|open_file|inspect)/.test(name)) return 'explore';
  if (/(exec|command|shell|terminal|test|build|lint|typecheck)/.test(name)) return 'run';
  return 'other';
};

const plural = (count: number, singular: string, pluralForm = `${singular}s`) =>
  count === 1 ? singular : pluralForm;

export const summarizeCodeToolEvents = (events: readonly ToolUsageEvent[]): string => {
  const counts = { edit: 0, explore: 0, run: 0, other: 0 };
  for (const event of events) counts[activityKind(event)] += 1;

  const parts = [
    counts.edit > 0 ? `Edited ${counts.edit} ${plural(counts.edit, 'file')}` : '',
    counts.explore > 0 ? `read ${counts.explore} ${plural(counts.explore, 'file')}` : '',
    counts.run > 0 ? `ran ${counts.run} ${plural(counts.run, 'command')}` : '',
    counts.other > 0 ? `used ${counts.other} ${plural(counts.other, 'tool')}` : '',
  ].filter(Boolean);

  if (parts.length === 0) return 'Working';
  return parts.join(', ').replace(/^./, (value) => value.toUpperCase());
};

const elapsedLabel = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  if (safeSeconds < 60) return `${safeSeconds}s`;
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${minutes}m ${String(remainder).padStart(2, '0')}s`;
};

const latestStatusText = (statuses: readonly AgentStatus[]): string | null => {
  const latest = statuses.at(-1);
  const detail = latest?.reasoning || latest?.result;
  if (detail?.trim()) return detail.trim();
  if (!latest?.status) return null;
  return latest.status
    .trim()
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^./, (character) => character.toUpperCase());
};

const eventIcon = (event: ToolUsageEvent) => {
  switch (activityKind(event)) {
    case 'edit':
      return Pencil;
    case 'explore':
      return Search;
    case 'run':
      return Terminal;
    case 'other':
      return Wrench;
  }
};

const eventTitle = (event: ToolUsageEvent, fallback: string): string => {
  switch (activityKind(event)) {
    case 'edit':
      return 'Edited files';
    case 'explore':
      return 'Read files';
    case 'run':
      return 'Ran a command';
    case 'other':
      return fallback;
  }
};

const EventResult = ({
  event,
  fallbackTitle,
  onShowSources,
}: {
  event: ToolUsageEvent;
  fallbackTitle: string;
  onShowSources?: (sources: SourceReference[]) => void;
}) => {
  const item = buildToolUsageViewItems([event])[0];
  if (!item) return null;
  const Icon = eventIcon(event);
  const sources = event.sources ?? [];
  const hasPreview = Boolean(event.resultPreview && !item.diffPreview);

  return (
    <div className="border-l border-slate-800 py-1 pl-5">
      <div className="flex min-w-0 items-center gap-2 text-sm text-slate-400">
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{eventTitle(event, fallbackTitle)}</span>
        {event.success ? (
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-label="Completed" />
        ) : event.status?.toLowerCase() === 'running' ? (
          <LoaderCircle
            className="h-3.5 w-3.5 shrink-0 animate-spin text-sky-400"
            aria-label="Running"
          />
        ) : (
          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-rose-400" aria-label="Failed" />
        )}
        {item.durationLabel ? (
          <span className="shrink-0 text-xs text-slate-600">{item.durationLabel}</span>
        ) : null}
      </div>
      {event.error ? <p className="mt-2 text-sm text-rose-300">{event.error}</p> : null}
      {hasPreview ? (
        <pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-slate-800 bg-slate-950/45 p-3 text-xs leading-5 whitespace-pre-wrap text-slate-300">
          {event.resultPreview}
        </pre>
      ) : null}
      {item.diffPreview ? <DiffPreview diff={item.diffPreview} maxLinesPerFile={48} /> : null}
      {sources.length > 0 ? (
        <button
          type="button"
          onClick={() => onShowSources?.(sources)}
          className="mt-2 text-xs text-sky-300 hover:text-sky-200"
        >
          {sources.length} {plural(sources.length, 'source')}
        </button>
      ) : null}
    </div>
  );
};

export const CodeExecutionTimeline: React.FC<CodeExecutionTimelineProps> = ({
  message,
  onShowSources,
}) => {
  const {
    agentStatuses,
    isStreaming,
    toolEvents: streamingToolEvents,
    finalToolEvents,
    pendingApproval: streamingPendingApproval,
  } = useStreaming();
  const [elapsedSeconds, setElapsedSeconds] = useState(message.elapsedSeconds ?? 0);
  const usesLiveExecution = Boolean(message.isAgentStatus || message.isStreaming);
  const activelyStreaming = usesLiveExecution && isStreaming;

  useEffect(() => {
    if (message.elapsedSeconds !== undefined) {
      setElapsedSeconds(message.elapsedSeconds);
      return undefined;
    }
    if (!activelyStreaming) return undefined;
    const startedAt = Date.now();
    const interval = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [activelyStreaming, message.elapsedSeconds]);

  const events = useMemo(
    () =>
      resolveExecutionToolEvents<ToolUsageEvent>({
        isStreaming: activelyStreaming,
        streamingEvents: streamingToolEvents,
        storedEvents: message.toolEvents,
        finalEvents: finalToolEvents,
      }),
    [activelyStreaming, finalToolEvents, message.toolEvents, streamingToolEvents]
  );
  const statuses = activelyStreaming ? agentStatuses : (message.agentStatuses ?? []);
  const statusText = latestStatusText(statuses);
  const approval = activelyStreaming ? streamingPendingApproval : (message.pendingApproval ?? null);
  const taskId = message.id.startsWith('task_') ? message.id : `task_${message.id}`;
  const summary = summarizeCodeToolEvents(events);

  if (events.length === 0 && !statusText && !approval) return null;

  return (
    <div className="w-full text-slate-300" data-testid="code-execution-timeline">
      <ExecutionStatusHeader
        activelyStreaming={activelyStreaming}
        elapsedSeconds={elapsedSeconds}
      />
      <InlineExecutionStatus visible={events.length === 0} text={statusText} />
      <ToolEventGroup events={events} summary={summary} onShowSources={onShowSources} />

      {approval ? (
        <ApprovalCard taskId={taskId} approval={approval} onDecision={() => undefined} />
      ) : null}
    </div>
  );
};

const ExecutionStatusHeader = ({
  activelyStreaming,
  elapsedSeconds,
}: {
  activelyStreaming: boolean;
  elapsedSeconds: number;
}) => (
  <div className="mb-3 flex items-center gap-2 border-b border-slate-800/80 pb-3 text-sm text-slate-500">
    {activelyStreaming ? (
      <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
    ) : (
      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
    )}
    <span>
      {activelyStreaming ? 'Working' : 'Worked'}
      {elapsedSeconds > 0 ? ` for ${elapsedLabel(elapsedSeconds)}` : ''}
    </span>
  </div>
);

const InlineExecutionStatus = ({ visible, text }: { visible: boolean; text: string | null }) =>
  visible && text ? (
    <div className="flex items-center gap-2 py-1 text-sm text-slate-400" role="status">
      <Wrench className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{text}</span>
    </div>
  ) : null;

const ToolEventGroup = ({
  events,
  summary,
  onShowSources,
}: {
  events: ToolUsageEvent[];
  summary: string;
  onShowSources?: (sources: SourceReference[]) => void;
}) => {
  const [expanded, setExpanded] = useState(false);
  if (events.length === 0) return null;

  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center gap-2 py-1 text-left text-sm text-slate-400 transition hover:text-slate-200"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <Wrench className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{summary}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      {expanded ? (
        <div className="mt-2 space-y-2">
          {buildToolUsageViewItems(events).map((item) => (
            <EventResult
              key={item.key}
              event={item.event}
              fallbackTitle={item.title}
              onShowSources={onShowSources}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
};
