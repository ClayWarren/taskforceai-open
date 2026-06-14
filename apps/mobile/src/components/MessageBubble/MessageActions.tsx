import React from 'react';
import { TouchableOpacity, View, Text } from 'react-native';
import { Icon } from '../Icon';
import { cn } from '@taskforceai/ui-kit';

export const MessageActions = ({
  isSpeaking,
  onSpeakPress,
  onCopyPress,
  onSharePress,
  onRatingPress,
  rating,
  copied,
}: {
  isSpeaking: boolean;
  onSpeakPress: () => void;
  onCopyPress: () => void;
  onSharePress?: () => void;
  onRatingPress: (value: number) => void;
  rating?: number;
  copied?: boolean;
}) => {
  const buttonStyle = "gap-xs flex-row items-center p-1";

  return (
    <View className="mt-sm flex-row items-center gap-2">
      {/* Copy Button */}
      <TouchableOpacity
        onPress={onCopyPress}
        className={buttonStyle}
        accessibilityLabel="Copy message"
        accessibilityRole="button"
      >
        <Icon name={copied ? 'Check' : 'Copy'} size={14} color={copied ? '#10b981' : '#94a3b8'} />
        <Text className={cn('text-xs font-medium', copied ? 'text-emerald-500' : 'text-text-muted')}>
          {copied ? 'Copied' : 'Copy'}
        </Text>
      </TouchableOpacity>

      {/* Listen Button */}
      <TouchableOpacity
        onPress={onSpeakPress}
        className={buttonStyle}
        accessibilityLabel={isSpeaking ? 'Stop listening' : 'Listen to message'}
        accessibilityRole="button"
      >
        <Icon
          name={isSpeaking ? 'Square' : 'Volume2'}
          size={14}
          color={isSpeaking ? '#f87171' : '#94a3b8'}
        />
        <Text className="text-text-muted text-xs font-medium">
          {isSpeaking ? 'Stop' : 'Listen'}
        </Text>
      </TouchableOpacity>

      {/* Share Button */}
      {onSharePress && (
        <TouchableOpacity
          onPress={onSharePress}
          className={buttonStyle}
          accessibilityLabel="Share message"
          accessibilityRole="button"
        >
          <Icon name="Share" size={14} color="#94a3b8" />
        </TouchableOpacity>
      )}

      {/* Feedback Buttons */}
      <View className="ml-1 flex-row items-center border-l border-white/10 pl-2 gap-1">
        <TouchableOpacity
          onPress={() => onRatingPress(1)}
          className="p-1"
          accessibilityLabel="Helpful"
          accessibilityRole="button"
        >
          <Icon
            name="ThumbsUp"
            size={16}
            color={rating === 1 ? '#10b981' : '#94a3b8'}
            fill={rating === 1 ? '#10b981' : 'none'}
          />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => onRatingPress(-1)}
          className="p-1"
          accessibilityLabel="Not helpful"
          accessibilityRole="button"
        >
          <Icon
            name="ThumbsDown"
            size={16}
            color={rating === -1 ? '#f43f5e' : '#94a3b8'}
            fill={rating === -1 ? '#f43f5e' : 'none'}
          />
        </TouchableOpacity>
      </View>
    </View>
  );
};

