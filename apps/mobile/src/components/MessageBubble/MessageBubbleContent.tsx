import { GlassView } from 'expo-glass-effect';
import React, { useMemo } from 'react';
import { View, type ViewStyle, Pressable } from 'react-native';
import { styled } from '../../utils/nativewind';
import { MessageTimestamp } from './MessageTimestamp';
import { MathMessageContent } from '../math/MathMessageContent';
import type { Message } from '../../types';

const StyledGlassView = styled(GlassView);

export const MessageBubbleContent = ({
  message,
  isUser,
  useGlass,
  onCopyPress,
}: {
  message: Message;
  isUser: boolean;
  useGlass: boolean;
  onCopyPress: () => void;
}) => {
  const bubbleContainerStyle = useMemo<ViewStyle>(() => ({
    maxWidth: '85%',
    alignSelf: isUser ? 'flex-end' : 'flex-start',
    borderRadius: 28,
    borderBottomRightRadius: isUser ? 10 : 28,
    borderBottomLeftRadius: isUser ? 28 : 10,
    overflow: 'hidden',
    backgroundColor: 'transparent',
  }), [isUser]);

  const bubbleInnerStyle = useMemo(() => ({
    backgroundColor: isUser ? 'rgba(0, 122, 255, 0.32)' : 'rgba(45, 45, 45, 0.35)',
    padding: 16,
  }), [isUser]);

  if (!message) {
    return null;
  }
  const BubbleComponent = useGlass ? StyledGlassView : View;

  const timestamp = message.updatedAt || message.createdAt;

  const bubbleProps = useGlass
    ? ({ glassEffectStyle: 'regular', tintColor: isUser ? '#007aff' : '#8e8e93' } as const)
    : {};

  return (
    <Pressable
      onLongPress={onCopyPress}
      delayLongPress={500}
      accessibilityRole="button"
      accessibilityHint="Long press to copy message"
      style={({ pressed }) => [
        bubbleContainerStyle,
        { opacity: pressed ? 0.95 : 1 },
      ]}
    >
      <BubbleComponent style={bubbleInnerStyle} {...bubbleProps}>
        <MathMessageContent content={message.content} isUser={isUser} />

        {timestamp && <MessageTimestamp timestamp={timestamp} isUser={isUser} />}
      </BubbleComponent>
    </Pressable>
  );
};
