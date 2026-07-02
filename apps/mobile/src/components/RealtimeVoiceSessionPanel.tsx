import { spacingTokens } from '@taskforceai/design-tokens';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

interface RealtimeVoiceSessionPanelProps {
  endedDurationMs: number | null;
  isActive: boolean;
  isCapturing: boolean;
  isPlaying: boolean;
}

const formatDuration = (durationMs: number): string => {
  const seconds = Math.max(1, Math.round(durationMs / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

const getAnimationDuration = ({
  isCapturing,
  isPlaying,
}: {
  isCapturing: boolean;
  isPlaying: boolean;
}): number => {
  if (isPlaying) return 1050;
  if (isCapturing) return 1800;
  return 2600;
};

export function RealtimeVoiceSessionPanel({
  endedDurationMs,
  isActive,
  isCapturing,
  isPlaying,
}: RealtimeVoiceSessionPanelProps) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!isActive) {
      return undefined;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: getAnimationDuration({ isCapturing, isPlaying }) / 2,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: getAnimationDuration({ isCapturing, isPlaying }) / 2,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [isActive, isCapturing, isPlaying, pulse]);

  if (!isActive && endedDurationMs === null) {
    return null;
  }

  if (!isActive && endedDurationMs !== null) {
    return (
      <View style={styles.endedPanel} accessibilityLiveRegion="polite">
        <View style={styles.endedDot} />
        <Text selectable style={styles.endedText}>
          Voice chat ended - {formatDuration(endedDurationMs)}
        </Text>
      </View>
    );
  }

  const orbScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.96, 1.04],
  });
  const glowScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.92, 1.18],
  });
  const glowOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.28, 0.48],
  });
  const activityLabel = isCapturing ? 'Listening' : isPlaying ? 'Speaking' : 'Voice session';

  return (
    <View style={styles.shell} accessibilityRole="progressbar" accessibilityLabel={activityLabel}>
      <View style={styles.orbStage}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.outerGlow,
            {
              opacity: glowOpacity,
              transform: [{ scale: glowScale }],
            },
          ]}
        />
        <Animated.View style={[styles.orbWrapper, { transform: [{ scale: orbScale }] }]}>
          <LinearGradient
            colors={['#e4fbff', '#83def8', '#0a88ff', '#006df0']}
            start={{ x: 0.18, y: 0.06 }}
            end={{ x: 0.86, y: 0.96 }}
            style={styles.orb}
          >
            <View style={styles.highlightPrimary} />
            <View style={styles.highlightSecondary} />
            <View style={styles.deepCore} />
          </LinearGradient>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    width: '100%',
    alignItems: 'center',
    paddingTop: spacingTokens.sm,
    paddingBottom: spacingTokens.md,
  },
  orbStage: {
    height: 102,
    width: 132,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outerGlow: {
    position: 'absolute',
    height: 108,
    width: 108,
    borderRadius: 54,
    backgroundColor: 'rgba(14, 165, 233, 0.72)',
  },
  orbWrapper: {
    height: 86,
    width: 86,
    borderRadius: 43,
    overflow: 'hidden',
    backgroundColor: '#0a88ff',
  },
  orb: {
    flex: 1,
    borderRadius: 43,
  },
  highlightPrimary: {
    position: 'absolute',
    top: 14,
    left: 24,
    height: 24,
    width: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
  },
  highlightSecondary: {
    position: 'absolute',
    top: 28,
    right: 18,
    height: 18,
    width: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(229, 255, 247, 0.78)',
  },
  deepCore: {
    position: 'absolute',
    bottom: 11,
    left: 17,
    height: 36,
    width: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(0, 120, 255, 0.84)',
  },
  endedPanel: {
    alignSelf: 'center',
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingTokens.xs,
    paddingHorizontal: spacingTokens.md,
    paddingVertical: spacingTokens.xs,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(96, 165, 250, 0.32)',
    backgroundColor: 'rgba(15, 23, 42, 0.86)',
  },
  endedDot: {
    height: 10,
    width: 10,
    borderRadius: 5,
    backgroundColor: '#38bdf8',
  },
  endedText: {
    color: 'rgba(226, 232, 240, 0.82)',
    fontSize: 13,
    fontWeight: '600',
  },
});
