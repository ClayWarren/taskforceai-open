import * as Clipboard from 'expo-clipboard';
import React, { useState, useEffect } from 'react';
import { View, Share, Vibration, TouchableOpacity, Text } from 'react-native';
import { useStreamingStore } from '../../streaming/useStreamingStore';
import { useMessageVoice } from '../../hooks/useMessageVoice';
import { isGlassEffectSupported } from '../../utils/glass';
import { ToolUsageList } from '../ToolUsageList';
import { SourcesList } from '../SourcesList';
import { Icon } from '../Icon';
import { MessageActions } from './MessageActions';
import { MessageBubbleContent } from './MessageBubbleContent';
import type { Message } from '../../types';
import { getMobileClient } from '../../api/client';
import { mobileLogger } from '../../logger';
import { cn } from '@taskforceai/ui-kit';

export const StandardMessage = ({ message }: { message: Message }) => {
  const isUser = message?.role === 'user';
  const useGlass = isGlassEffectSupported();
  const { isSpeaking, toggleSpeech } = useMessageVoice(message?.content || '');
  const isGlobalStreaming = useStreamingStore(state => state.isStreaming);
  // Only the active/latest message needs to care about global streaming state for certain UI traits
  const isMessageStreaming = message?.isStreaming || (isGlobalStreaming && message?.id === 'streaming-temp-id');

  const [rating, setRating] = useState<number>(message?.rating ?? 0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setRating(message?.rating ?? 0);
  }, [message?.rating]);

  if (!message) {
    return null;
  }

  const handleCopy = async () => {
    try {
      Vibration.vibrate(50);
      await Clipboard.setStringAsync(message.content || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      mobileLogger.error('Failed to copy message', { error });
    }
  };

  const handleRating = async (value: number) => {
    const newRating = rating === value ? 0 : value;
    const previousRating = rating;
    setRating(newRating);

    try {
      const client = getMobileClient();
      await client.submitMessageFeedback(message.id, newRating);
    } catch (error) {
      setRating(previousRating);
      mobileLogger.error('Failed to submit feedback', { error, messageId: message.id });
    }
  };

  const handleShare = async () => {
    try {
      await Share.share({
        message: message.content || '',
        title: 'TaskForceAI Response',
      });
    } catch (error) {
      mobileLogger.error('Failed to share message', { error });
    }
  };

  const hasToolEvents = (message.toolEvents?.length ?? 0) > 0;
  const hasSources = (message.sources?.length ?? 0) > 0;

  return (
    <View className={cn('my-sm px-md', isUser && 'items-end')}>
      <MessageBubbleContent
        message={message}
        isUser={isUser}
        useGlass={useGlass}
        onCopyPress={() => { void handleCopy(); }}
      />

      {!isUser ? (
        <View className="items-start">
          <MessageActions
            isSpeaking={isSpeaking}
            onSpeakPress={() => { void toggleSpeech(); }}
            onCopyPress={() => { void handleCopy(); }}
            onSharePress={() => { void handleShare(); }}
            onRatingPress={(val) => { void handleRating(val); }}
            rating={rating}
            copied={copied}
          />
        </View>
      ) : (
        <View className="mt-sm items-end">
          <TouchableOpacity
            onPress={() => { void handleCopy(); }}
            className="gap-xs flex-row items-center p-1"
            accessibilityLabel="Copy message"
            accessibilityRole="button"
          >
            <Icon name={copied ? 'Check' : 'Copy'} size={14} color={copied ? '#10b981' : '#94a3b8'} />
            <Text className={cn('text-xs font-medium', copied ? 'text-emerald-500' : 'text-text-muted')}>
              {copied ? 'Copied' : 'Copy'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {!isUser && hasToolEvents && !isMessageStreaming && (
        <View className="mt-xs">
          <ToolUsageList toolEvents={message.toolEvents!} />
        </View>
      )}
      {!isUser && hasSources && (
        <View className="mt-xs">
          <SourcesList sources={message.sources!} />
        </View>
      )}
    </View>
  );
};
