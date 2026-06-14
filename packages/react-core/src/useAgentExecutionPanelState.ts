import {
  createExecutionDisplayViewModel,
  type AgentVisualizationData,
  type ExecutionDisplayViewModel,
  type ToolUsageEventLike,
} from '@taskforceai/shared/utils/agent-progress';
import { useEffect, useMemo, useRef, useState } from 'react';

export interface AgentExecutionPanelStateOptions<
  TAgent extends AgentVisualizationData,
  TToolEvent extends ToolUsageEventLike,
> {
  agents: TAgent[];
  elapsedSeconds: number;
  modelLabel?: string | null;
  defaultModelLabel?: string;
  isStreaming?: boolean;
  isCompletedSnapshot?: boolean;
  toolEvents?: TToolEvent[];
  computerUseEnabled?: boolean;
  autoExpandWhenStreaming?: boolean;
}

export interface AgentExecutionPanelState<
  TAgent extends AgentVisualizationData,
  TToolEvent extends ToolUsageEventLike,
> {
  displayModel: ExecutionDisplayViewModel<TAgent, TToolEvent>;
  indicatorState: TAgent['state'];
  isExpanded: boolean;
  selectedAgent: TAgent | null;
  expand: () => void;
  collapse: () => void;
  toggle: () => void;
  selectAgent: (agentId: number | null) => void;
}

export function useAgentExecutionPanelState<
  TAgent extends AgentVisualizationData,
  TToolEvent extends ToolUsageEventLike,
>({
  agents,
  elapsedSeconds,
  modelLabel,
  defaultModelLabel,
  isStreaming = false,
  isCompletedSnapshot = false,
  toolEvents = [],
  computerUseEnabled = false,
  autoExpandWhenStreaming = false,
}: AgentExecutionPanelStateOptions<TAgent, TToolEvent>): AgentExecutionPanelState<
  TAgent,
  TToolEvent
> {
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null);
  const hasAutoExpandedRef = useRef(false);

  useEffect(() => {
    if (!autoExpandWhenStreaming) {
      return;
    }
    if (isStreaming && !hasAutoExpandedRef.current) {
      hasAutoExpandedRef.current = true;
      setIsExpanded(true);
    }
    if (!isStreaming) {
      hasAutoExpandedRef.current = false;
    }
  }, [autoExpandWhenStreaming, isStreaming]);

  const displayModel = useMemo(
    () =>
      createExecutionDisplayViewModel<TAgent, TToolEvent>({
        agents,
        elapsedSeconds,
        modelLabel,
        defaultModelLabel,
        isStreaming,
        isCompletedSnapshot,
        toolEvents,
        computerUseEnabled,
      }),
    [
      agents,
      computerUseEnabled,
      defaultModelLabel,
      elapsedSeconds,
      isCompletedSnapshot,
      isStreaming,
      modelLabel,
      toolEvents,
    ]
  );

  const selectedAgent = useMemo(() => {
    if (selectedAgentId === null) {
      return null;
    }
    return agents.find((agent) => agent.id === selectedAgentId) ?? null;
  }, [agents, selectedAgentId]);

  useEffect(() => {
    if (selectedAgentId !== null && !agents.some((agent) => agent.id === selectedAgentId)) {
      setSelectedAgentId(null);
    }
  }, [agents, selectedAgentId]);

  return {
    displayModel,
    indicatorState: displayModel.indicatorState as TAgent['state'],
    isExpanded,
    selectedAgent,
    expand: () => setIsExpanded(true),
    collapse: () => {
      setSelectedAgentId(null);
      setIsExpanded(false);
    },
    toggle: () => setIsExpanded((previous) => !previous),
    selectAgent: setSelectedAgentId,
  };
}
