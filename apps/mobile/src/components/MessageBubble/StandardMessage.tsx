import * as Clipboard from 'expo-clipboard';
import React, { useState, useEffect } from 'react';
import { View, Share, Vibration, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { useStreamingStore } from '../../streaming/useStreamingStore';
import { useMessageVoice } from '../../hooks/useMessageVoice';
import { isGlassEffectSupported } from '../../utils/glass';
import { ToolUsageList } from '../ToolUsageList';
import { SourcesList } from '../SourcesList';
import { Icon } from '../Icon';
import { MessageActions } from './MessageActions';
import { MessageBubbleContent } from './MessageBubbleContent';
import { MessageSpeechPlayback } from './MessageSpeechPlayback';
import { MathMessageContent } from '../math/MathMessageContent';
import type { Message } from '../../types';
import { getMobileClient } from '../../api/client';
import { mobileLogger } from '../../logger';
import { cn } from '@taskforceai/ui-kit/utils';
import { formatMessageTime } from '../../utils/date';

const REALTIME_VOICE_MESSAGE_PREFIX = 'realtime-voice-';

export const StandardMessage = ({ message }: { message: Message }) => {
  const isUser = message?.role === 'user';
  const isRealtimeVoiceAssistant =
    !isUser && message?.id?.startsWith(REALTIME_VOICE_MESSAGE_PREFIX);
  const useGlass = isGlassEffectSupported();
  const {
    elapsedSeconds,
    isPaused,
    isPreparing,
    isSpeaking,
    stopSpeech,
    togglePlaybackPaused,
    toggleSpeech,
  } = useMessageVoice(message?.content || '');
  const isGlobalStreaming = useStreamingStore(state => state.isStreaming);
  // Only the active/latest message needs to care about global streaming state for certain UI traits
  const isMessageStreaming = message?.isStreaming || (isGlobalStreaming && message?.id === 'streaming-temp-id');

  const [rating, setRating] = useState<number>(message?.rating ?? 0);
  const [copied, setCopied] = useState(false);
  const [isDetailsVisible, setIsDetailsVisible] = useState(false);

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
  const timestamp = message.updatedAt || message.createdAt;

  if (isRealtimeVoiceAssistant) {
    return (
      <View className="my-sm px-md items-start">
        <View style={styles.realtimeAssistantText}>
          <MathMessageContent content={message.content} isUser={false} />
        </View>

        {isSpeaking && (
          <MessageSpeechPlayback
            elapsedSeconds={elapsedSeconds}
            isPaused={isPaused}
            isPreparing={isPreparing}
            onPausePress={togglePlaybackPaused}
            onStopPress={() => {
              stopSpeech();
            }}
          />
        )}

        <View style={styles.realtimeActionRow}>
          <TouchableOpacity
            onPress={() => { void handleCopy(); }}
            style={styles.realtimeIconButton}
            accessibilityLabel="Copy message"
            accessibilityRole="button"
          >
            <Icon name={copied ? 'Check' : 'Copy'} size={15} color={copied ? '#10b981' : '#94a3b8'} />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={isSpeaking ? undefined : () => { void toggleSpeech(); }}
            disabled={isSpeaking}
            style={styles.realtimeIconButton}
            accessibilityLabel={isSpeaking ? 'Message is playing' : 'Listen to message'}
            accessibilityRole="button"
          >
            <Icon
              name="Volume2"
              size={15}
              color={isSpeaking ? 'rgba(148, 163, 184, 0.45)' : '#94a3b8'}
            />
          </TouchableOpacity>

          {timestamp && (
            <TouchableOpacity
              onPress={() => setIsDetailsVisible((visible) => !visible)}
              style={styles.realtimeIconButton}
              accessibilityLabel="Message details"
              accessibilityRole="button"
            >
              <Icon name="MoreHorizontal" size={16} color="#94a3b8" />
            </TouchableOpacity>
          )}

          {timestamp && isDetailsVisible && (
            <Text style={styles.realtimeDetailsText}>{formatMessageTime(timestamp)}</Text>
          )}
        </View>
      </View>
    );
  }

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
          {isSpeaking && (
            <MessageSpeechPlayback
              elapsedSeconds={elapsedSeconds}
              isPaused={isPaused}
              isPreparing={isPreparing}
              onPausePress={togglePlaybackPaused}
              onStopPress={() => {
                stopSpeech();
              }}
            />
          )}
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

const styles = StyleSheet.create({
  realtimeAssistantText: {
    maxWidth: '88%',
    paddingVertical: 4,
  },
  realtimeActionRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  realtimeIconButton: {
    minHeight: 30,
    minWidth: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  realtimeDetailsText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '500',
  },
});
