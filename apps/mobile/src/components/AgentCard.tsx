/**
 * Agent Card - Individual agent status display that mirrors the web AgentExecutionPanel list view
 */
import { colorTokens } from '@taskforceai/design-tokens';
import React from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';

export type AgentState = 'queued' | 'running' | 'completed' | 'failed';

export interface AgentCardData {
  id: number;
  label: string;
  status: string;
  displayStatus: string;
  progressValue: number;
  result?: string;
  reasoning?: string;
  state: AgentState;
  model?: string;
}

interface AgentCardProps {
  agent: AgentCardData;
  onExpand?: () => void;
}

const palette = colorTokens.dark;

const stateColors: Record<AgentState, string> = {
  queued: 'rgba(255, 255, 255, 0.4)',
  running: palette.primary,
  completed: palette.success,
  failed: palette.error,
};

export const AgentCard = React.memo(function AgentCardComponent({ agent, onExpand }: AgentCardProps) {
  const progressPercent = Math.round(agent.progressValue * 100);

  const containerStyle = {
    borderColor: 'rgba(148, 163, 184, 0.2)',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  };

  if (agent.state === 'completed') {
    Object.assign(containerStyle, {
      borderColor: palette.success,
      backgroundColor: 'rgba(40, 167, 69, 0.08)',
    });
  }
  if (agent.state === 'failed') {
    Object.assign(containerStyle, {
      borderColor: palette.error,
      backgroundColor: 'rgba(220, 53, 69, 0.08)',
    });
  }

  return (
    <TouchableOpacity
      className="px-md py-md rounded-2xl border"
      style={containerStyle}
      onPress={onExpand}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityHint="Double tap to view agent details"
    >
      <View className="mb-sm flex-row items-center justify-between">
        <View className="flex-row items-center">
          <View
            className="mr-sm h-2 w-2 rounded-full"
            style={{ backgroundColor: stateColors[agent.state] }}
          />
          <View>
            <Text className="text-text text-xs font-semibold">{agent.label.toUpperCase()}</Text>
            {agent.model && (
              <Text className="text-text-muted text-[9px] font-medium uppercase tracking-tight">
                {agent.model.split('/').pop()}
              </Text>
            )}
          </View>
        </View>
        {agent.state === 'running' && (
          <ActivityIndicator
            size="small"
            color={palette.primary}
            accessibilityRole="progressbar"
            accessibilityLabel="Agent is running"
          />
        )}
      </View>

      <Text className="mb-sm text-text-muted text-xs">{agent.displayStatus}</Text>

      {agent.progressValue > 0 && (
        <View className="mb-sm flex-row items-center" accessible accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: progressPercent }}>
          <View className="mr-sm h-1 flex-1 overflow-hidden rounded bg-white/10">
            <View
              className="h-full rounded"
              style={{
                width: `${(agent.progressValue * 100).toFixed(1)}%` as any,
                backgroundColor: stateColors[agent.state],
              }}
            />
          </View>
          <Text className="text-text-muted min-w-[40px] text-right text-[11px]">
            {progressPercent}%
          </Text>
        </View>
      )}

      {agent.result && agent.result.trim().length > 0 && (
        <Text className="text-text-muted text-xs leading-4" numberOfLines={2}>
          {agent.result.trim()}
        </Text>
      )}
    </TouchableOpacity>
  );
});
