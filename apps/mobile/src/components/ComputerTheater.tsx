import React, { useMemo } from "react";
import { View, Text, Image, ScrollView } from "react-native";
import {
  COMPUTER_THEATER_COPY,
  createComputerTheaterAgentLabel,
  createComputerTheaterViewModel,
} from "@taskforceai/presenters";
import type { ToolUsageEvent } from "../types";
import { Icon } from "./Icon";
import {
  computerTheaterPalette,
  computerTheaterStyles as styles,
} from "./ComputerTheater.styles";

interface ComputerTheaterProps {
  toolEvents: ToolUsageEvent[];
  agentLabel?: string;
  isStreaming: boolean;
  autoExpand?: boolean;
  showWhenEmpty?: boolean;
  preScreenStatus?: string | null;
}

export const ComputerTheater: React.FC<ComputerTheaterProps> = ({
  toolEvents,
  agentLabel,
  isStreaming,
  showWhenEmpty = false,
  preScreenStatus = null,
}) => {
  const viewModel = useMemo(
    () =>
      createComputerTheaterViewModel(toolEvents, {
        isStreaming,
        logLimit: 3,
        preScreenStatus,
      }),
    [isStreaming, preScreenStatus, toolEvents],
  );
  const {
    actionLogs,
    computerEvents,
    cursor,
    imageSource,
    screenMessage,
    screenshot,
    statusText,
  } = viewModel;
  const displayAgentLabel = createComputerTheaterAgentLabel(agentLabel);

  if (computerEvents.length === 0 && !showWhenEmpty) return null;

  const renderScreenshot = (_isFullScreen: boolean) => {
    if (!screenshot) {
      return (
        <View style={styles.fullPlaceholder}>
          <Icon name="Activity" size={32} color="rgba(255,255,255,0.2)" />
          <Text style={styles.placeholderText}>{screenMessage}</Text>
        </View>
      );
    }

    return (
      <View style={styles.screenshotWrapper}>
        <Image
          source={{ uri: imageSource ?? "" }}
          style={styles.screenshot}
          resizeMode="contain"
          accessible={true}
          accessibilityRole="image"
          accessibilityLabel="Live computer screenshot"
        />
        {/* Action Overlay (Cursor indicator) */}
        {cursor && (
          <View
            testID="computer-cursor"
            style={[
              styles.cursor,
              {
                left: cursor.left as any,
                top: cursor.top as any,
              },
            ]}
          >
            <View style={styles.cursorInner} />
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.fullScreenContainer}>
      <View style={styles.modalHeader}>
        <View style={styles.row}>
          <View style={styles.headerIconContainer}>
            <Icon
              name="Monitor"
              size={24}
              color={computerTheaterPalette.primary}
            />
          </View>
          <View>
            <Text style={styles.modalTitle}>
              {COMPUTER_THEATER_COPY.modeTitle.toUpperCase()}
            </Text>
            <Text style={styles.modalSubtitle}>
              {displayAgentLabel} • {statusText}
            </Text>
          </View>
        </View>

        <View style={styles.row}>
          {isStreaming && (
            <View style={styles.liveFollowBadge}>
              <View style={styles.liveFollowDotContainer}>
                <View style={styles.liveFollowDot} />
              </View>
              <Text style={styles.liveFollowText}>
                {COMPUTER_THEATER_COPY.liveFollow.toUpperCase()}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Main Viewport */}
      <View style={styles.mainViewport}>
        <View style={styles.viewportContainer}>{renderScreenshot(true)}</View>
      </View>

      {/* Footer / Logs */}
      <View style={[styles.logsContainer, { paddingBottom: 10 }]}>
        <Text style={styles.logsTitle}>
          {COMPUTER_THEATER_COPY.recentActions.toUpperCase()}
        </Text>
        <ScrollView showsVerticalScrollIndicator={false}>
          {actionLogs.map((event, i) => (
            <View key={i} style={styles.logItem}>
              <Text style={styles.logTimestamp}>{event.timestamp}</Text>
              <Text style={styles.logToolName}>[{event.toolName}]</Text>
              <Text style={styles.logArgs} numberOfLines={1}>
                {event.argumentsText}
              </Text>
              {i === 0 && <View style={styles.activeLogDot} />}
            </View>
          ))}
        </ScrollView>
      </View>
    </View>
  );
};
