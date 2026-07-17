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
import { submitMessageFeedback } from '../../api/messages';
import { mobileLogger } from '../../logger';
import { cn } from '@taskforceai/ui-kit/utils';
import { formatMessageTime } from '../../utils/date';

const REALTIME_VOICE_MESSAGE_PREFIX = 'realtime-voice-';

type MessageVoice = ReturnType<typeof useMessageVoice>;

const deriveMessageFlags = (message: Message | undefined, isGlobalStreaming: boolean) => {
  const isUser = message?.role === 'user';
  return {
    isUser,
    isRealtimeVoiceAssistant: !isUser && message?.id?.startsWith(REALTIME_VOICE_MESSAGE_PREFIX),
    // Only the active/latest message needs to care about global streaming state for certain UI traits
    isMessageStreaming:
      message?.isStreaming || (isGlobalStreaming && message?.id === 'streaming-temp-id'),
    hasToolEvents: (message?.toolEvents?.length ?? 0) > 0,
    hasSources: (message?.sources?.length ?? 0) > 0,
    timestamp: message?.updatedAt || message?.createdAt,
  };
};

const RealtimeVoiceMessage = ({
  message,
  privateChat,
  voice,
  copied,
  timestamp,
  isDetailsVisible,
  onToggleDetails,
  onCopy,
}: {
  message: Message;
  privateChat: boolean;
  voice: MessageVoice;
  copied: boolean;
  timestamp: Message['updatedAt'];
  isDetailsVisible: boolean;
  onToggleDetails: () => void;
  onCopy: () => void;
}) => (
  <View className="my-sm px-md items-start">
    <View style={styles.realtimeAssistantText}>
      <MathMessageContent content={message.content} isUser={false} />
    </View>

    {!privateChat && voice.isSpeaking && (
      <MessageSpeechPlayback
        elapsedSeconds={voice.elapsedSeconds}
        isPaused={voice.isPaused}
        isPreparing={voice.isPreparing}
        onPausePress={voice.togglePlaybackPaused}
        onStopPress={() => {
          voice.stopSpeech();
        }}
      />
    )}

    <View style={styles.realtimeActionRow}>
      <TouchableOpacity
        onPress={onCopy}
        style={styles.realtimeIconButton}
        accessibilityLabel="Copy message"
        accessibilityRole="button"
      >
        <Icon name={copied ? 'Check' : 'Copy'} size={15} color={copied ? '#10b981' : '#94a3b8'} />
      </TouchableOpacity>

      {!privateChat && (
        <TouchableOpacity
          onPress={voice.isSpeaking ? undefined : () => { void voice.toggleSpeech(); }}
          disabled={voice.isSpeaking}
          style={styles.realtimeIconButton}
          accessibilityLabel={voice.isSpeaking ? 'Message is playing' : 'Listen to message'}
          accessibilityRole="button"
        >
          <Icon
            name="Volume2"
            size={15}
            color={voice.isSpeaking ? 'rgba(148, 163, 184, 0.45)' : '#94a3b8'}
          />
        </TouchableOpacity>
      )}

      {timestamp && (
        <TouchableOpacity
          onPress={onToggleDetails}
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

const AssistantFooter = ({
  privateChat,
  voice,
  rating,
  copied,
  onCopy,
  onShare,
  onRate,
}: {
  privateChat: boolean;
  voice: MessageVoice;
  rating: number;
  copied: boolean;
  onCopy: () => void;
  onShare: () => void;
  onRate: (value: number) => void;
}) => (
  <View className="items-start">
    {!privateChat && voice.isSpeaking && (
      <MessageSpeechPlayback
        elapsedSeconds={voice.elapsedSeconds}
        isPaused={voice.isPaused}
        isPreparing={voice.isPreparing}
        onPausePress={voice.togglePlaybackPaused}
        onStopPress={() => {
          voice.stopSpeech();
        }}
      />
    )}
    <MessageActions
      isSpeaking={voice.isSpeaking}
      onSpeakPress={() => { void voice.toggleSpeech(); }}
      onCopyPress={onCopy}
      onSharePress={onShare}
      onRatingPress={onRate}
      rating={rating}
      copied={copied}
      privateChat={privateChat}
    />
  </View>
);

const UserCopyFooter = ({ copied, onCopy }: { copied: boolean; onCopy: () => void }) => (
  <View className="mt-sm items-end">
    <TouchableOpacity
      onPress={onCopy}
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
);

export const StandardMessage = ({
  message,
  privateChat = false,
}: {
  message: Message;
  privateChat?: boolean;
}) => {
  const useGlass = isGlassEffectSupported();
  const voice = useMessageVoice(message?.content || '');
  const isGlobalStreaming = useStreamingStore(state => state.isStreaming);
  const flags = deriveMessageFlags(message, isGlobalStreaming);

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
      setTimeout(setCopied, 2000, false);
    } catch (error) {
      mobileLogger.error('Failed to copy message', { error });
    }
  };

  const handleRating = async (value: number) => {
    const newRating = rating === value ? 0 : value;
    const previousRating = rating;
    setRating(newRating);

    try {
      await submitMessageFeedback(message.id, newRating);
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

  if (flags.isRealtimeVoiceAssistant) {
    return (
      <RealtimeVoiceMessage
        message={message}
        privateChat={privateChat}
        voice={voice}
        copied={copied}
        timestamp={flags.timestamp}
        isDetailsVisible={isDetailsVisible}
        onToggleDetails={() => setIsDetailsVisible((visible) => !visible)}
        onCopy={() => { void handleCopy(); }}
      />
    );
  }

  return (
    <View className={cn('my-sm px-md', flags.isUser && 'items-end')}>
      <MessageBubbleContent
        message={message}
        isUser={flags.isUser}
        useGlass={useGlass}
        onCopyPress={() => { void handleCopy(); }}
      />

      {!flags.isUser ? (
        <AssistantFooter
          privateChat={privateChat}
          voice={voice}
          rating={rating}
          copied={copied}
          onCopy={() => { void handleCopy(); }}
          onShare={() => { void handleShare(); }}
          onRate={(value) => { void handleRating(value); }}
        />
      ) : (
        <UserCopyFooter copied={copied} onCopy={() => { void handleCopy(); }} />
      )}

      {!flags.isUser && flags.hasToolEvents && !flags.isMessageStreaming && (
        <View className="mt-xs">
          <ToolUsageList toolEvents={message.toolEvents!} />
        </View>
      )}
      {!flags.isUser && flags.hasSources && (
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
