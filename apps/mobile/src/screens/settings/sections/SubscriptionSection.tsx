import React from 'react';
import { ActivityIndicator, Platform, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  formatProfileCreditBalanceLabel,
  formatProfileUsageResetLabel,
  formatSubscriptionSourceLabel,
  resolveProfileMessageUsageLabel,
} from '@taskforceai/shared/profile/view-model';

import { formatDate, formatUnixDate } from '../../../utils/format';
import { useTheme } from '../../../contexts/ThemeContext';
import { ActionButton } from '../../../components/ActionButton';
import { Section, InfoRow } from '../components';

interface SubscriptionData {
  data?: {
    subscription?: {
      status: string | null;
      current_period_end: number | null;
      subscription_source?: string | null;
    } | null;
  } | null;
  isFetching: boolean;
}

interface BillingBalanceData {
  data?: {
    creditBalance?: number | null;
    currentPeriodEnd?: number | null;
    currentPeriodStart?: number | null;
  } | null;
  isFetching: boolean;
}

interface SubscriptionSectionProps {
  billingBalanceQuery: BillingBalanceData;
  user: {
    plan: string | null;
    message_count: number | null;
    subscription_status: string | null;
    current_period_end: string | null;
    subscription_source: string | null;
  } | null;
  subscriptionQuery: SubscriptionData;
}

export function SubscriptionSection({
  billingBalanceQuery,
  user,
  subscriptionQuery,
}: SubscriptionSectionProps) {
  const { theme } = useTheme();
  const { t } = useTranslation();

  const subscriptionSummary = subscriptionQuery.data?.subscription ?? null;
  const balanceSummary = billingBalanceQuery.data ?? null;
  const messageUsageLabel = resolveProfileMessageUsageLabel({
    plan: user?.plan,
    messageCount: user?.message_count,
  });
  const creditBalanceLabel = formatProfileCreditBalanceLabel(balanceSummary?.creditBalance);
  const resetLabel = formatProfileUsageResetLabel({
    currentPeriodStart: balanceSummary?.currentPeriodStart,
    currentPeriodEnd: balanceSummary?.currentPeriodEnd ?? subscriptionSummary?.current_period_end,
  });
  const subscriptionStatus = subscriptionSummary?.status ?? user?.subscription_status ?? null;
  const subscriptionRenewalDate =
    subscriptionSummary?.current_period_end != null
      ? formatUnixDate(subscriptionSummary.current_period_end)
      : formatDate(user?.current_period_end ?? null);
  const subscriptionSource = subscriptionSummary?.subscription_source;
  const managedIn = formatSubscriptionSourceLabel(subscriptionSource ?? user?.subscription_source, {
    fallback: t('mobile.settings.notAvailable', { defaultValue: 'N/A' }),
    stripe: t('mobile.profile.sources.stripe', { defaultValue: 'Stripe (Web/Desktop)' }),
    app_store: t('mobile.profile.sources.appStore', { defaultValue: 'Apple App Store' }),
    play_store: t('mobile.profile.sources.playStore', { defaultValue: 'Google Play Store' }),
  });

  return (
    <Section title={t('mobile.profile.subscription', { defaultValue: 'Subscription' })}>
      <InfoRow
        label={t('mobile.settings.currentPlan', { defaultValue: 'Current plan' })}
        value={(user?.plan ?? 'free').toUpperCase()}
      />
      <InfoRow
        label={t('mobile.profile.messages', { defaultValue: 'Messages' })}
        value={messageUsageLabel}
      />
      {creditBalanceLabel ? (
        <InfoRow
          label={t('mobile.profile.credits', { defaultValue: 'Credits' })}
          value={creditBalanceLabel}
        />
      ) : null}
      {resetLabel ? (
        <InfoRow
          label={t('mobile.profile.usageWindow', { defaultValue: 'Usage window' })}
          value={resetLabel}
        />
      ) : null}
      <InfoRow
        label={t('mobile.profile.status', { defaultValue: 'Status' })}
        value={
          subscriptionStatus ??
          t('mobile.settings.notAvailable', {
            defaultValue: 'N/A',
          })
        }
      />
      <InfoRow
        label={t('mobile.profile.renews', { defaultValue: 'Renews' })}
        value={subscriptionRenewalDate}
      />
      <InfoRow
        label={t('mobile.profile.managedIn', { defaultValue: 'Managed In' })}
        value={String(managedIn)}
      />
      {(subscriptionQuery.isFetching || billingBalanceQuery.isFetching) && (
        <View className="mt-2 flex-row items-center gap-2">
          <ActivityIndicator size="small" color={theme.colors.primary} />
          <Text className="text-text-muted text-xs">
            {t('mobile.profile.refreshingSubscription', {
              defaultValue: 'Refreshing subscription...',
            })}
          </Text>
        </View>
      )}
    </Section>
  );
}

interface SubscriptionActionsProps {
  userPlan: string | null | undefined;
  isProcessing: boolean;
  proPriceLabel: string | null;
  superPriceLabel: string | null;
  onPurchasePlan: (plan: 'pro' | 'super') => void;
  onRestorePurchases: () => void;
  onManageBilling: () => void;
}

export function SubscriptionActions({
  userPlan,
  isProcessing,
  proPriceLabel,
  superPriceLabel,
  onPurchasePlan,
  onRestorePurchases,
  onManageBilling,
}: SubscriptionActionsProps) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const storeAccountLabel =
    Platform.OS === 'android' ? 'Google Play account' : 'App Store account';
  const renderPurchaseOption = ({
    plan,
    title,
    priceLabel,
    description,
  }: {
    plan: 'pro' | 'super';
    title: string;
    priceLabel: string | null;
    description: string;
  }) => (
    <View
      className="gap-2 rounded-2xl border border-white/10 bg-white/5 p-4"
      accessibilityLabel={`${title} subscription purchase option`}
    >
      <Text className="text-text-muted text-xs font-semibold uppercase">{title}</Text>
      <Text
        selectable
        className="text-white"
        style={{ fontSize: 28, fontWeight: '800', lineHeight: 34 }}
      >
        {priceLabel ? `Billed ${priceLabel} monthly` : 'Billed monthly'}
      </Text>
      <Text className="text-text-muted text-xs leading-4">{description}</Text>
      <ActionButton
        className="mb-0 mt-1"
        variant={plan === 'super' ? 'primary' : 'primaryOutline'}
        disabled={isProcessing || !priceLabel}
        isLoading={isProcessing}
        onPress={() => onPurchasePlan(plan)}
      >
        {priceLabel ? `Subscribe to ${title}` : 'Price unavailable'}
      </ActionButton>
      <Text
        className="text-center text-[11px] leading-4"
        style={{ color: theme.colors.textMuted }}
      >
        Auto-renews monthly. Charged to your {storeAccountLabel} until canceled.
      </Text>
    </View>
  );

  return (
    <Section title={t('mobile.profile.actions', { defaultValue: 'Actions' })}>
      <View className="px-md py-md gap-3">
        {userPlan === 'free' ? (
          <>
            {renderPurchaseOption({
              plan: 'pro',
              title: 'Pro',
              priceLabel: proPriceLabel,
              description:
                'Expanded message limits, file workflows, and autonomous agent capacity across your TaskForceAI apps.',
            })}

            {renderPurchaseOption({
              plan: 'super',
              title: 'Super',
              priceLabel: superPriceLabel,
              description:
                'Highest limits, larger agent runs, and priority capacity across your TaskForceAI apps.',
            })}
            <Text className="text-text-muted text-center text-[11px] leading-4">
              The billed amount shown above is the monthly auto-renewable subscription
              charge. Manage or cancel in subscription settings.
            </Text>
          </>
        ) : null}

        <ActionButton
          className="mb-0"
          disabled={isProcessing}
          isLoading={isProcessing}
          onPress={() => {
            onRestorePurchases();
          }}
        >
          {t('mobile.profile.restorePurchases', { defaultValue: 'Restore Purchases' })}
        </ActionButton>

        {userPlan !== 'free' ? (
          <Text className="text-text-muted text-center text-[11px] leading-4">
            Manage or cancel your active subscription in the store account where it was
            purchased.
          </Text>
        ) : null}

        <ActionButton className="mb-0" onPress={onManageBilling}>
          {t('mobile.profile.manageBilling', { defaultValue: 'Manage Billing' })}
        </ActionButton>
      </View>
    </Section>
  );
}
