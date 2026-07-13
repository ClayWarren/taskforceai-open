import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { Icon } from '../Icon';

const formatElapsed = (elapsedSeconds: number): string => {
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

export const MessageSpeechPlayback = ({
  elapsedSeconds,
  isPaused,
  isPreparing,
  onPausePress,
  onStopPress,
}: {
  elapsedSeconds: number;
  isPaused: boolean;
  isPreparing: boolean;
  onPausePress: () => void;
  onStopPress: () => void;
}) => (
  <View
    style={styles.container}
    accessibilityLabel="Speech playback controls"
    accessibilityRole="toolbar"
  >
    <TouchableOpacity
      onPress={isPreparing ? undefined : onPausePress}
      style={styles.controlButton}
      disabled={isPreparing}
      accessibilityLabel={
        isPreparing
          ? 'Preparing speech playback'
          : isPaused
            ? 'Resume speech playback'
            : 'Pause speech playback'
      }
      accessibilityRole="button"
    >
      {isPreparing ? (
        <ActivityIndicator color="#020617" size="small" testID="speech-playback-loading" />
      ) : (
        <Icon name={isPaused ? 'Play' : 'Pause'} size={24} color="#020617" />
      )}
    </TouchableOpacity>
    <Text selectable style={styles.elapsedText}>
      {formatElapsed(elapsedSeconds)}
    </Text>
    <Text selectable style={styles.rateText}>
      1x
    </Text>
    <View style={styles.spacer} />
    <TouchableOpacity
      onPress={onStopPress}
      style={styles.controlButton}
      accessibilityLabel="Stop speech playback"
      accessibilityRole="button"
    >
      <Icon name="X" size={24} color="#020617" />
    </TouchableOpacity>
  </View>
);

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderColor: 'rgba(15,23,42,0.08)',
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 16,
    marginBottom: 6,
    marginTop: 10,
    minHeight: 56,
    minWidth: 260,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  controlButton: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  elapsedText: {
    color: '#020617',
    fontSize: 18,
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
  },
  rateText: {
    color: '#020617',
    fontSize: 18,
    fontWeight: '700',
  },
  spacer: {
    flex: 1,
  },
});
