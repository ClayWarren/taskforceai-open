import React from 'react';
import {
  getPublicModelLabel,
  parseAgentProgress,
  type AgentProgressState,
} from '@taskforceai/shared';

import { useStreaming } from '../../lib/providers/StreamingProvider';

const toNormalizedStatus = (status: string): string => status.trim().toUpperCase();

const formatAgentKey = (
  agentId: number | undefined,
  status: string,
  fallbackIndex: number
): string => {
  if (Number.isFinite(agentId)) {
    return `agent-${agentId}`;
  }
  return `agent-${toNormalizedStatus(status).replace(/[^A-Z0-9]+/g, '-')}-${fallbackIndex}`;
};

const computeProgressMeta = (
  status: string
): { ariaValue: number; width: string; color: string; isActive: boolean } =>
  (() => {
    const progress = parseAgentProgress(status);
    const colorByState: Record<AgentProgressState, string> = {
      completed: 'green',
      failed: 'red',
      queued: 'blue',
      running: 'blue',
    };

    return {
      ariaValue: Math.round(progress.progress * 100),
      width: `${progress.progress * 100}%`,
      color: colorByState[progress.state],
      isActive: progress.state === 'running',
    };
  })();

const formatDefaultAgentLabel = (agentId: number | undefined, fallbackIndex: number): string =>
  `AGENT ${String((agentId ?? fallbackIndex) + 1).padStart(2, '0')}`;

const formatAgentLabel = (
  entry: { agent_id?: number; model?: string },
  agentLabels: string[],
  fallbackIndex: number
): string => {
  const label = entry.model || agentLabels[entry.agent_id ?? fallbackIndex];
  return getPublicModelLabel(label) ?? formatDefaultAgentLabel(entry.agent_id, fallbackIndex);
};

const AgentProgress: React.FC = () => {
  const { isStreaming, agentStatuses, agentLabels } = useStreaming();

  if (!isStreaming || agentStatuses.length === 0) {
    return null;
  }

  const activeCount = agentStatuses.filter((s) => computeProgressMeta(s.status).isActive).length;

  return (
    <div className="agent-progress-container" role="region" aria-label="Agent execution progress">
      <h2>🤖 Agent Progress</h2>
      <div className="agents-container" role="list">
        {agentStatuses.map((entry, index) => (
          <div
            key={formatAgentKey(entry.agent_id, entry.status, index)}
            className="agent-line"
            role="listitem"
          >
            {(() => {
              const label = formatAgentLabel(entry, agentLabels, index);
              return <span className="agent-label">{label}</span>;
            })()}
            {(() => {
              const meta = computeProgressMeta(entry.status);
              const label = formatAgentLabel(entry, agentLabels, index);
              return (
                <div
                  className="progress"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={meta.ariaValue}
                  aria-label={`${label} progress`}
                >
                  <div
                    className="progress-bar"
                    style={{
                      width: meta.width,
                      backgroundColor: meta.color,
                    }}
                  ></div>
                </div>
              );
            })()}
            <span className="progress-status" aria-live="polite">
              {entry.status}
            </span>
          </div>
        ))}
        {activeCount > 1 && (
          <div className="agent-line parallel-indicator" role="status" aria-live="polite">
            <span className="agent-label parallel-label">↗ PARALLEL</span>
            <span className="parallel-text">{activeCount} agents working simultaneously</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default AgentProgress;
