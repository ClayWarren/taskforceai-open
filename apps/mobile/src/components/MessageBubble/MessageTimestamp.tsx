import React from 'react';
import { Text } from 'react-native';
import { formatMessageTime } from '../../utils/date';
import { cn } from '@taskforceai/ui-kit/utils';

export const MessageTimestamp = ({
  timestamp,
  isUser,
}: {
  timestamp: number | string | Date;
  isUser: boolean;
}) => (
  <Text className={cn('mt-xs text-[11px]', isUser ? 'text-white/70' : 'text-text-muted')}>
    {formatMessageTime(timestamp)}
  </Text>
);
