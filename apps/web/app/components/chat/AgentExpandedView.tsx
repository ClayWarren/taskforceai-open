import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { type AgentVisualizationData } from '@taskforceai/shared/utils/agent-progress';

import { groupBy } from '@taskforceai/shared/utils/collection';
import type { SourceReference, ToolUsageEvent } from '../../lib/types';
import { AgentEmptyState, AgentExpandedHeader, AgentList } from './AgentExpandedPanels';
import { AgentDetail } from './AgentExpandedDetail';

export type AgentVisualization = AgentVisualizationData;

interface AgentExpandedViewProps {
  agents: AgentVisualization[];
  elapsedSeconds: number;
  headerText?: string;
  modelLabel: string;
  indicatorState: AgentVisualization['state'];
  toolEvents: ToolUsageEvent[];
  reasoning?: string;
  searchInteractive?: boolean;
  onShowSources?: (sources: SourceReference[]) => void;
  onCollapse: () => void;
}

const AgentExpandedView: React.FC<AgentExpandedViewProps> = ({
  agents,
  elapsedSeconds,
  headerText,
  modelLabel,
  indicatorState,
  toolEvents,
  reasoning,
  searchInteractive,
  onShowSources,
  onCollapse,
}) => {
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null);

  useEffect(() => {
    if (selectedAgentId === null) {
      return;
    }
    if (!agents.some((agent) => agent.id === selectedAgentId)) {
      setSelectedAgentId(null);
    }
  }, [agents, selectedAgentId]);

  const selectedAgent = useMemo(() => {
    if (selectedAgentId === null) {
      return null;
    }
    return agents.find((agent) => agent.id === selectedAgentId) ?? null;
  }, [agents, selectedAgentId]);

  const activeCount = useMemo(
    () => agents.filter((agent) => agent.state === 'running').length,
    [agents]
  );
  const completedCount = useMemo(
    () => agents.filter((agent) => agent.state === 'completed').length,
    [agents]
  );
  const resolvedHeaderText =
    headerText ?? (indicatorState === 'completed' ? 'Completed' : 'Agents Working');

  const eventsByAgent = useMemo(() => {
    const normalizedAgentLabels = new Set(
      agents.flatMap((agent) => [agent.label, agent.model].filter(Boolean).map(normalizeAgentLabel))
    );

    const groupedById = groupBy(
      toolEvents.filter((event): event is ToolUsageEvent & { agentId: number } =>
        Number.isFinite(event.agentId)
      ),
      (event) => String(event.agentId)
    );

    const byId = new Map<number, ToolUsageEvent[]>(
      Object.entries(groupedById).map(([key, events]) => [Number(key), events ?? []])
    );

    const groupedByLabel = groupBy(
      toolEvents.filter(
        (event) => typeof event.agentLabel === 'string' && event.agentLabel.trim().length > 0
      ),
      (event) => normalizeAgentLabel(event.agentLabel)
    );

    const byLabel = new Map<string, ToolUsageEvent[]>(
      Object.entries(groupedByLabel).map(([key, events]) => [key, events ?? []])
    );

    const groupedByOrdinal = groupBy(
      toolEvents.filter((event) => extractAgentOrdinal(event.agentLabel) !== null),
      (event) => String(extractAgentOrdinal(event.agentLabel))
    );

    const byOrdinal = new Map<number, ToolUsageEvent[]>(
      Object.entries(groupedByOrdinal).map(([key, events]) => [Number(key), events ?? []])
    );

    const unattributed = toolEvents.filter((event) => {
      if (Number.isFinite(event.agentId)) {
        return false;
      }
      const normalizedLabel = normalizeAgentLabel(event.agentLabel);
      if (!normalizedLabel || normalizedLabel === 'agent') {
        return true;
      }
      return (
        !normalizedAgentLabels.has(normalizedLabel) &&
        extractAgentOrdinal(event.agentLabel) === null
      );
    });

    return { byId, byLabel, byOrdinal, unattributed };
  }, [agents, toolEvents]);

  const getEventsForAgent = useCallback(
    (agent: AgentVisualization): ToolUsageEvent[] => {
      const fromId = eventsByAgent.byId.get(agent.id);
      if (fromId && fromId.length > 0) {
        return fromId;
      }
      const normalizedLabel = normalizeAgentLabel(agent.label);
      const fromLabel = eventsByAgent.byLabel.get(normalizedLabel);
      if (fromLabel && fromLabel.length > 0) {
        return fromLabel;
      }
      const normalizedModel = normalizeAgentLabel(agent.model);
      const fromModel = normalizedModel ? eventsByAgent.byLabel.get(normalizedModel) : undefined;
      if (fromModel && fromModel.length > 0) {
        return fromModel;
      }
      const fromOrdinal = eventsByAgent.byOrdinal.get(agent.id + 1);
      if (fromOrdinal && fromOrdinal.length > 0) {
        return fromOrdinal;
      }
      if (
        eventsByAgent.unattributed.length > 0 &&
        (agents.length === 1 || agent.state === 'running')
      ) {
        return eventsByAgent.unattributed;
      }
      return [];
    },
    [agents.length, eventsByAgent]
  );

  const selectedAgentEvents = useMemo(() => {
    if (!selectedAgent) {
      return toolEvents;
    }
    return getEventsForAgent(selectedAgent);
  }, [getEventsForAgent, selectedAgent, toolEvents]);
  return (
    <div
      className="agent-execution-expanded rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-xl shadow-blue-500/10 backdrop-blur"
      role="region"
      aria-label="Multi-agent progress view"
    >
      <AgentExpandedHeader
        activeCount={activeCount}
        agentCount={agents.length}
        completedCount={completedCount}
        elapsedSeconds={elapsedSeconds}
        headerText={resolvedHeaderText}
        indicatorState={indicatorState}
        modelLabel={modelLabel}
        onCollapse={() => {
          setSelectedAgentId(null);
          onCollapse();
        }}
      />

      {selectedAgent ? (
        <AgentDetail
          agent={selectedAgent}
          events={selectedAgentEvents}
          reasoning={reasoning}
          searchInteractive={searchInteractive}
          onBack={() => setSelectedAgentId(null)}
          {...(onShowSources ? { onShowSources } : {})}
        />
      ) : agents.length === 0 ? (
        <AgentEmptyState indicatorState={indicatorState} />
      ) : (
        <AgentList
          agents={agents}
          getEventsForAgent={getEventsForAgent}
          onSelectAgent={setSelectedAgentId}
          selectedAgentId={selectedAgentId}
        />
      )}
    </div>
  );
};

const normalizeAgentLabel = (label?: string): string =>
  (label ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const extractAgentOrdinal = (label?: string): number | null => {
  const normalized = normalizeAgentLabel(label);
  const match = normalized.match(/\bagent\s+(\d+)\b/);
  if (!match) {
    return null;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
};

export default AgentExpandedView;
