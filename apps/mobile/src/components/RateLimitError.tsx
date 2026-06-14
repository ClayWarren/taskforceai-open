/**
 * Rate Limit Error - Display rate limit errors with countdown
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';

import { usePurchases } from '../hooks/usePurchases';
import { Icon } from './Icon';
import { formatRateLimitCountdown } from '@taskforceai/shared/errors/rate-limit-view';
import { cn } from '@taskforceai/ui-kit';

interface RateLimitErrorProps {
  message: string;
  resetTime?: string;
  onUpgrade?: () => void;
  onDismiss?: () => void;
}

export function RateLimitError({
  message,
  resetTime,
  onUpgrade,
  onDismiss,
}: RateLimitErrorProps) {
  const [timeRemaining, setTimeRemaining] = useState<string>('');
  const { purchasePro, isProcessing } = usePurchases();
  const handleUpgrade =
    onUpgrade ??
    (() => {
      void purchasePro();
    });
  const { t } = useTranslation();

  useEffect(() => {
    if (!resetTime) return;

    const updateCountdown = () => {
      setTimeRemaining(formatRateLimitCountdown(resetTime) ?? '');
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);

    return () => clearInterval(interval);
  }, [resetTime]);

  return (
    <View
      className="mx-md my-sm border-error px-lg py-lg rounded-2xl border"
      style={{ backgroundColor: 'rgba(220, 53, 69, 0.1)' }}
    >
      <View className="mb-sm flex-row items-center justify-between">
        <Text className="text-error text-base font-semibold">
          {t('mobile.rateLimit.title')}
        </Text>
        {onDismiss && (
          <TouchableOpacity
            onPress={onDismiss}
            className="h-6 w-6 items-center justify-center rounded-full bg-white/10"
          >
            <Icon name="X" size={14} color="#e2e8f0" />
          </TouchableOpacity>
        )}
      </View>

      <Text className="mb-md text-text text-sm leading-5">{message}</Text>

      {timeRemaining && (
        <View className="mb-md px-md py-sm flex-row items-center rounded-lg bg-black/20">
          <Text className="mr-sm text-text-muted text-xs">
            {t('mobile.rateLimit.resetIn')}
          </Text>
          <Text className="text-error text-base font-semibold">
            {timeRemaining}
          </Text>
        </View>
      )}

      {handleUpgrade && (
        <TouchableOpacity
          className={cn(
            'mb-sm px-lg py-md items-center rounded-xl bg-primary',
            isProcessing && 'opacity-70'
          )}
          onPress={handleUpgrade}
          disabled={isProcessing}
        >
          {isProcessing ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text className="text-base font-semibold text-white">
              {t('mobile.rateLimit.upgrade')}
            </Text>
          )}
        </TouchableOpacity>
      )}

      <Text className="text-text-muted text-center text-xs leading-4">
        {t('mobile.rateLimit.hint')}
      </Text>
    </View>
  );
}
