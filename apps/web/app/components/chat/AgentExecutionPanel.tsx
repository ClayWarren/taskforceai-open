import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useAgentExecutionPanelState } from '@taskforceai/react-core';
import { createComputerTheaterPreScreenStatus } from '@taskforceai/presenters';

import {
  buildAgentVisualizations,
  resolveExecutionAgentVisualizations,
  resolveExecutionReasoning,
  resolveExecutionToolEvents,
  smoothStreamingAgentProgress,
} from '@taskforceai/presenters/utils/agent-progress';
import { useStreaming } from '../../lib/providers/StreamingProvider';
import { AgentStatus, Message, SourceReference, ToolUsageEvent } from '../../lib/types';
import AgentExpandedView, { AgentVisualization } from './AgentExpandedView';
import { ApprovalCard } from './ApprovalCard';

const ExecutionReplay = lazy(() =>
  import('./ExecutionReplay').then((m) => ({ default: m.ExecutionReplay }))
);
const ComputerTheater = lazy(() =>
  import('./ComputerTheater').then((m) => ({ default: m.ComputerTheater }))
);

interface AgentExecutionPanelProps {
  message: Message;
  onShowSources?: (sources: SourceReference[]) => void;
}

interface ReplayData {
  agentStatuses: AgentStatus[];
  toolEvents: ToolUsageEvent[];
  reasoning?: string;
  isComplete: boolean;
}

const MODEL_LABEL = 'HEAVY';

const resolveReplayTaskId = (message: Message): string | null => {
  if (message.id.startsWith('task_')) {
    return message.id;
  }
  return null;
};

const AgentExecutionPanel: React.FC<AgentExecutionPanelProps> = ({ message, onShowSources }) => {
  const {
    agentStatuses,
    isStreaming,
    toolEvents: streamingToolEvents,
    finalToolEvents,
    modelBadge,
    reasoning: streamingReasoning,
    finalReasoning,
    pendingApproval: streamingPendingApproval,
    computerUseEnabled,
  } = useStreaming();
  const [elapsedSeconds, setElapsedSeconds] = useState(message.elapsedSeconds ?? 0);
  const [replayData, setReplayData] = useState<ReplayData | null>(null);
  const hasStoredElapsedSnapshot = !isStreaming && message.elapsedSeconds !== undefined;
  const replayTaskId = useMemo(() => resolveReplayTaskId(message), [message]);

  const effectivePendingApproval = useMemo(() => {
    if (isStreaming) return streamingPendingApproval;
    return message.pendingApproval || null;
  }, [isStreaming, streamingPendingApproval, message.pendingApproval]);

  const onFrameUpdate = useCallback((data: ReplayData) => {
    setReplayData(data);
  }, []);

  useEffect(() => {
    // If message has stored elapsed time (from completed/loaded message), use that
    if (message.elapsedSeconds !== undefined) {
      setElapsedSeconds(message.elapsedSeconds);
      return undefined;
    }

    // If not streaming, don't run timer
    if (!isStreaming) {
      return undefined;
    }

    // Start timer for active streaming
    const start = Date.now();
    const tick = () => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    };

    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [isStreaming, message.elapsedSeconds]);

  const agents: AgentVisualization[] = useMemo(() => {
    if (replayData) {
      return buildAgentVisualizations(replayData.agentStatuses, {
        uppercaseLabel: true,
      });
    }
    return resolveExecutionAgentVisualizations({
      isStreaming,
      streamingStatuses: agentStatuses,
      storedStatuses: message.agentStatuses,
      uppercaseLabel: true,
    });
  }, [replayData, agentStatuses, isStreaming, message.agentStatuses]);

  const displayAgents: AgentVisualization[] = useMemo(() => {
    const shouldSmoothProgress = isStreaming && !replayData;
    return agents.map((agent) =>
      smoothStreamingAgentProgress(agent, elapsedSeconds, shouldSmoothProgress)
    );
  }, [agents, elapsedSeconds, isStreaming, replayData]);

  const resolvedToolEvents = useMemo(() => {
    return resolveExecutionToolEvents<ToolUsageEvent>({
      isStreaming,
      streamingEvents: streamingToolEvents,
      storedEvents: message.toolEvents,
      finalEvents: finalToolEvents,
      replayEvents: replayData?.toolEvents,
    });
  }, [replayData, finalToolEvents, isStreaming, message.toolEvents, streamingToolEvents]);

  const resolvedReasoning = useMemo(() => {
    return resolveExecutionReasoning({
      isStreaming,
      streamingReasoning,
      storedReasoning: message.reasoning,
      finalReasoning,
      replayReasoning: replayData?.reasoning,
    });
  }, [replayData, isStreaming, streamingReasoning, message.reasoning, finalReasoning]);

  const { displayModel, indicatorState, isExpanded, toggle } = useAgentExecutionPanelState<
    AgentVisualization,
    ToolUsageEvent
  >({
    agents: displayAgents,
    elapsedSeconds,
    modelLabel: modelBadge,
    defaultModelLabel: MODEL_LABEL,
    isStreaming: replayData ? false : isStreaming,
    isCompletedSnapshot: replayData?.isComplete ?? (hasStoredElapsedSnapshot && !replayData),
    toolEvents: resolvedToolEvents,
    computerUseEnabled,
    autoExpandWhenStreaming: true,
  });

  const handleToggle = toggle;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleToggle();
    }
  };

  const indicatorClass = `agent-execution-dot agent-execution-dot--${effectivePendingApproval ? 'awaiting' : indicatorState}`;
  const progressClass = `agent-execution-progress-fill agent-execution-progress-fill--${effectivePendingApproval ? 'awaiting' : indicatorState}`;
  const headerText = effectivePendingApproval ? 'Action Required' : displayModel.headerText;

  return (
    <div className="flex w-full flex-col gap-4">
      {replayTaskId && !isStreaming && (
        <Suspense fallback={null}>
          <ExecutionReplay taskId={replayTaskId} onFrameUpdate={onFrameUpdate} />
        </Suspense>
      )}

      {displayModel.shouldShowComputerTheater && (
        <Suspense fallback={null}>
          <ComputerTheater
            toolEvents={resolvedToolEvents}
            isStreaming={isStreaming}
            agentLabel={displayModel.runningAgentLabel}
            preScreenStatus={createComputerTheaterPreScreenStatus(displayAgents)}
          />
        </Suspense>
      )}

      {effectivePendingApproval && message.id && (
        <ApprovalCard
          taskId={message.id.startsWith('task_') ? message.id : `task_${message.id}`}
          approval={effectivePendingApproval}
          onDecision={() => {
            // Decision was sent, UI will update on next progress pulse
          }}
        />
      )}

      {isExpanded ? (
        <AgentExpandedView
          agents={displayAgents}
          elapsedSeconds={elapsedSeconds}
          headerText={headerText}
          modelLabel={displayModel.resolvedModelLabel}
          indicatorState={indicatorState}
          toolEvents={resolvedToolEvents}
          reasoning={resolvedReasoning}
          searchInteractive={!isStreaming}
          {...(onShowSources ? { onShowSources } : {})}
          onCollapse={handleToggle}
        />
      ) : (
        <div
          className="agent-execution-compact"
          onClick={handleToggle}
          onKeyDown={handleKeyDown}
          role="button"
          tabIndex={0}
        >
          <div className="agent-execution-header">
            <div className="agent-execution-header-title">
              <span className={indicatorClass} aria-hidden="true"></span>
              <span>{headerText}</span>
              <span className="agent-execution-separator" aria-hidden="true">
                &middot;
              </span>
              <span className="agent-execution-model">{displayModel.resolvedModelLabel}</span>
              <span className="agent-execution-separator" aria-hidden="true">
                &middot;
              </span>
              <span className="agent-execution-timer">{displayModel.elapsedLabel}</span>
            </div>
            <div className="agent-execution-header-hint">Expand</div>
          </div>
          <div
            className="agent-execution-progress-track"
            role="progressbar"
            aria-label="Overall agent progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(displayModel.overallProgress * 100)}
          >
            <div className={progressClass} style={{ width: displayModel.progressWidth }}></div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AgentExecutionPanel;
