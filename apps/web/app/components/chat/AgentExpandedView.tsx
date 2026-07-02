import React, { useCallback, useEffect, useMemo, useState } from 'react';

import type { SourceReference, ToolUsageEvent } from '../../lib/types';
import { AgentEmptyState, AgentExpandedHeader, AgentList } from './AgentExpandedPanels';
import { AgentDetail } from './AgentExpandedDetail';
import type { AgentVisualization } from './AgentExpandedTypes';

export type { AgentVisualization };

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

export type AgentToolEventsByAgent = {
  byId: Map<number, ToolUsageEvent[]>;
  byLabel: Map<string, ToolUsageEvent[]>;
  byOrdinal: Map<number, ToolUsageEvent[]>;
  unattributed: ToolUsageEvent[];
};

export const groupToolEventsByAgent = (
  agents: AgentVisualization[],
  toolEvents: ToolUsageEvent[]
): AgentToolEventsByAgent => {
  const normalizedAgentLabels = new Set<string>();
  for (const agent of agents) {
    if (agent.label) {
      normalizedAgentLabels.add(normalizeAgentLabel(agent.label));
    }
    if (agent.model) {
      normalizedAgentLabels.add(normalizeAgentLabel(agent.model));
    }
  }

  const byId = new Map<number, ToolUsageEvent[]>();
  const byLabel = new Map<string, ToolUsageEvent[]>();
  const byOrdinal = new Map<number, ToolUsageEvent[]>();
  const unattributed: ToolUsageEvent[] = [];

  for (const event of toolEvents) {
    const agentId = event.agentId;
    const hasAgentId = typeof agentId === 'number' && Number.isFinite(agentId);
    if (hasAgentId) {
      const events = byId.get(agentId);
      if (events) {
        events.push(event);
      } else {
        byId.set(agentId, [event]);
      }
    }

    const rawLabel = event.agentLabel;
    const hasLabel = typeof rawLabel === 'string' && rawLabel.trim().length > 0;
    const normalizedLabel = hasLabel ? normalizeAgentLabel(rawLabel) : '';
    const ordinal = hasLabel ? extractAgentOrdinalFromNormalized(normalizedLabel) : null;

    if (hasLabel) {
      const events = byLabel.get(normalizedLabel);
      if (events) {
        events.push(event);
      } else {
        byLabel.set(normalizedLabel, [event]);
      }
    }

    if (ordinal !== null) {
      const events = byOrdinal.get(ordinal);
      if (events) {
        events.push(event);
      } else {
        byOrdinal.set(ordinal, [event]);
      }
    }

    if (
      !hasAgentId &&
      (!normalizedLabel ||
        normalizedLabel === 'agent' ||
        (!normalizedAgentLabels.has(normalizedLabel) && ordinal === null))
    ) {
      unattributed.push(event);
    }
  }

  return { byId, byLabel, byOrdinal, unattributed };
};

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

  const eventsByAgent = useMemo(
    () => groupToolEventsByAgent(agents, toolEvents),
    [agents, toolEvents]
  );

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

const extractAgentOrdinalFromNormalized = (normalized: string): number | null => {
  const match = normalized.match(/\bagent\s+(\d+)\b/);
  if (!match) {
    return null;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
};

export default AgentExpandedView;
