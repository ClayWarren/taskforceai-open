/**
 * AgentExecutionPanel - Multi-agent visualization component
 *
 * Mirrors the three viewing states used on the web:
 * 1) compact summary
 * 2) expanded agent grid
 * 3) focused agent detail
 */
import { colorTokens } from '@taskforceai/design-tokens';
import { useMemo } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useAgentExecutionPanelState } from '@taskforceai/react-core';
import { createComputerTheaterPreScreenStatus } from '@taskforceai/presenters';

import type { AgentStatus, ToolUsageEvent } from '../types';
import {
  buildAgentVisualizations,
  resolveAgentStateLabel,
  splitAgentResultLines,
} from '@taskforceai/presenters/utils/agent-progress';
import { AgentCard, AgentCardData, AgentState } from './AgentCard';
import { ToolUsageList } from './ToolUsageList';
import { ComputerTheater } from './ComputerTheater';

interface AgentExecutionPanelProps {
  agentStatuses: AgentStatus[];
  elapsedSeconds: number;
  toolEvents?: ToolUsageEvent[];
  modelLabel?: string | null;
  isStreaming?: boolean;
}

const palette = colorTokens.dark;

const stateColors: Record<AgentState, string> = {
  queued: 'rgba(255, 255, 255, 0.4)',
  running: palette.primary,
  completed: palette.success,
  failed: palette.error,
};

export function AgentExecutionPanel({
  agentStatuses,
  elapsedSeconds,
  toolEvents = [],
  modelLabel,
  isStreaming = false,
}: AgentExecutionPanelProps) {
  const agents = useMemo(
    () => buildAgentVisualizations(agentStatuses) as AgentCardData[],
    [agentStatuses]
  );

  const { displayModel, indicatorState, isExpanded, selectedAgent, collapse, expand, selectAgent } =
    useAgentExecutionPanelState<AgentCardData, ToolUsageEvent>({
      agents,
      elapsedSeconds,
      modelLabel,
      isStreaming,
      toolEvents,
    });

  const renderHeaderMeta = () => (
    <View className="flex-row flex-wrap items-center">
      <View
        className="mr-xs h-2 w-2 rounded-full"
        style={{ backgroundColor: stateColors[indicatorState] }}
      />
      <Text className="text-text text-xs font-bold">{displayModel.headerText}</Text>
      <Text className="text-text-muted px-1 text-xs">•</Text>
      <Text className="text-[11px] font-bold text-primary">
        {displayModel.resolvedModelLabel}
      </Text>
      <Text className="text-text-muted px-1 text-xs">•</Text>
      <Text className="text-text-muted text-[11px]">{displayModel.elapsedLabel}</Text>
    </View>
  );

  const renderAgentList = () => {
    if (agents.length === 0) {
      return (
        <View
          className="px-md py-xl items-center justify-center rounded-2xl border border-white/10"
          style={{ backgroundColor: 'rgba(255, 255, 255, 0.03)' }}
        >
          <Text className="text-text-muted text-center text-sm">
            {indicatorState === 'completed'
              ? 'Agent progress data was not saved'
              : 'Agents are spinning up...'}
          </Text>
        </View>
      );
    }

    return (
      <View className="-mx-1 flex-row flex-wrap">
        {agents.map((agent) => (
          <View key={agent.id} className="w-1/2 px-1 pb-2">
            <AgentCard agent={agent} onExpand={() => selectAgent(agent.id)} />
          </View>
        ))}
      </View>
    );
  };

  const renderAgentDetail = () => {
    if (!selectedAgent) {
      return null;
    }

    const logLines = splitAgentResultLines(selectedAgent.result);

    return (
      <View className="mb-md px-md py-md rounded-2xl border border-white/10">
        <View className="mb-md flex-row items-center justify-between">
          <View>
            <Text className="text-text text-xs font-semibold">
              {selectedAgent.label.toUpperCase()}
            </Text>
            <View
              className="mt-xs px-sm rounded-full border py-0.5"
              style={{ borderColor: stateColors[selectedAgent.state] }}
            >
              <Text
                className="text-[11px] font-semibold"
                style={{ color: stateColors[selectedAgent.state] }}
              >
                {selectedAgent.displayStatus}
              </Text>
            </View>
          </View>
          <TouchableOpacity onPress={() => selectAgent(null)}>
            <Text className="text-xs font-semibold text-primary">Back to agents</Text>
          </TouchableOpacity>
        </View>

        <View className="mb-xs h-1.5 overflow-hidden rounded-full bg-white/10">
          <View
            className="h-full rounded-full"
            style={{
              backgroundColor: stateColors[selectedAgent.state],
              width: `${(selectedAgent.progressValue * 100).toFixed(1)}%` as any,
            }}
          />
        </View>
        <Text className="mb-sm text-text-muted text-xs">
          {selectedAgent.state === 'failed'
            ? 'This agent encountered an error'
            : resolveAgentStateLabel(selectedAgent)}
        </Text>

        <View className="rounded-2xl border border-white/10 bg-black/20">
          {logLines.length > 0 ? (
            <ScrollView contentContainerStyle={{ padding: 12 }}>
              {logLines.map((line, index) => (
                <Text key={`${selectedAgent.id}-line-${index}`} className="text-text text-xs">
                  {line}
                </Text>
              ))}
            </ScrollView>
          ) : (
            <View className="px-md py-lg">
              <Text className="text-text-muted text-center text-sm">
                {selectedAgent.state === 'running'
                  ? `${selectedAgent.label} is analyzing the question...`
                  : `Waiting for ${selectedAgent.label} to start...`}
              </Text>
            </View>
          )}
        </View>

        {selectedAgent.reasoning && (
          <View className="mt-md px-md py-md rounded-2xl border border-purple-500/20 bg-purple-500/5">
            <View className="mb-sm flex-row items-center">
              <Text className="text-purple-300 text-[10px] font-bold tracking-wider uppercase">
                Thinking
              </Text>
            </View>
            <Text className="text-purple-100/80 text-xs leading-relaxed">
              {selectedAgent.reasoning}
            </Text>
          </View>
        )}
      </View>
    );
  };

  if (!isExpanded) {
    return (
      <TouchableOpacity
        className="w-full"
        activeOpacity={0.85}
        onPress={expand}
      >
        <View className="mb-xs flex-row items-center justify-between">
          {renderHeaderMeta()}
          <Text className="text-[11px] font-bold text-primary">EXPAND</Text>
        </View>
        <View className="h-1.5 overflow-hidden rounded-full bg-white/10">
          <View
            className="h-full rounded-full"
            style={{
              width: displayModel.progressWidth as any,
              backgroundColor: stateColors[indicatorState],
            }}
          />
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <View className="w-full">
      <View className="mb-sm flex-row items-center justify-between">
        <View>
          {renderHeaderMeta()}
          <Text className="text-text-muted text-[11px] font-medium">
            {displayModel.runningCount > 0
              ? `${displayModel.runningCount} agent${displayModel.runningCount === 1 ? '' : 's'} running`
              : 'All agents idle'}
          </Text>
        </View>
        <TouchableOpacity onPress={collapse}>
          <Text className="text-[11px] font-bold text-primary">COLLAPSE</Text>
        </TouchableOpacity>
      </View>

      <View className="mt-xs">
        {selectedAgent ? renderAgentDetail() : renderAgentList()}
      </View>

      {displayModel.hasComputerUseEvents && (
        <ComputerTheater
          toolEvents={toolEvents}
          isStreaming={isStreaming}
          agentLabel={displayModel.runningAgentLabel}
          preScreenStatus={createComputerTheaterPreScreenStatus(agentStatuses)}
        />
      )}

      {displayModel.hasToolEvents && (
        <View className="mt-sm">
          <ToolUsageList toolEvents={toolEvents} variant="embedded" />
        </View>
      )}
    </View>
  );
}
