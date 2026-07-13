import React from 'react';
import { ActivityIndicator, Platform, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  formatProfileCreditBalanceLabel,
  formatProfileUsageResetLabel,
  formatSubscriptionSourceLabel,
  resolveProfileMessageUsageLabel,
} from '@taskforceai/presenters/profile/view-model';

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

type SubscriptionSummary = NonNullable<NonNullable<SubscriptionData['data']>['subscription']>;
type BalanceSummary = NonNullable<BillingBalanceData['data']>;

const renewalDate = (subscription: SubscriptionSummary | null, user: SubscriptionSectionProps['user']) =>
  subscription?.current_period_end != null
    ? formatUnixDate(subscription.current_period_end)
    : formatDate(user?.current_period_end ?? null);

const usageResetLabel = (balance: BalanceSummary | null, subscription: SubscriptionSummary | null) =>
  formatProfileUsageResetLabel({
    currentPeriodStart: balance?.currentPeriodStart,
    currentPeriodEnd: balance?.currentPeriodEnd ?? subscription?.current_period_end,
  });

const managedInLabel = (
  subscription: SubscriptionSummary | null,
  user: SubscriptionSectionProps['user'],
  labels: Parameters<typeof formatSubscriptionSourceLabel>[1]
) => formatSubscriptionSourceLabel(subscription?.subscription_source ?? user?.subscription_source, labels);

const subscriptionSectionViewModel = (
  props: SubscriptionSectionProps,
  labels: Parameters<typeof formatSubscriptionSourceLabel>[1]
) => {
  const subscriptionSummary = props.subscriptionQuery.data?.subscription ?? null;
  const balanceSummary = props.billingBalanceQuery.data ?? null;
  const subscriptionStatus = subscriptionSummary?.status ?? props.user?.subscription_status ?? null;
  return {
    currentPlan: (props.user?.plan ?? 'free').toUpperCase(),
    messageUsageLabel: resolveProfileMessageUsageLabel({
      plan: props.user?.plan,
      messageCount: props.user?.message_count,
    }),
    creditBalanceLabel: formatProfileCreditBalanceLabel(balanceSummary?.creditBalance),
    resetLabel: usageResetLabel(balanceSummary, subscriptionSummary),
    subscriptionStatus,
    subscriptionRenewalDate: renewalDate(subscriptionSummary, props.user),
    managedIn: managedInLabel(subscriptionSummary, props.user, labels),
    isFetching: props.subscriptionQuery.isFetching || props.billingBalanceQuery.isFetching,
  };
};

export function SubscriptionSection({
  billingBalanceQuery,
  user,
  subscriptionQuery,
}: SubscriptionSectionProps) {
  const { theme } = useTheme();
  const { t } = useTranslation();

  const {
    currentPlan,
    messageUsageLabel,
    creditBalanceLabel,
    resetLabel,
    subscriptionStatus,
    subscriptionRenewalDate,
    managedIn,
    isFetching,
  } = subscriptionSectionViewModel(
    { billingBalanceQuery, user, subscriptionQuery },
    {
      fallback: t('mobile.settings.notAvailable', { defaultValue: 'N/A' }),
      stripe: t('mobile.profile.sources.stripe', { defaultValue: 'Stripe (Web/Desktop)' }),
      app_store: t('mobile.profile.sources.appStore', { defaultValue: 'Apple App Store' }),
      play_store: t('mobile.profile.sources.playStore', { defaultValue: 'Google Play Store' }),
    }
  );

  return (
    <Section title={t('mobile.profile.subscription', { defaultValue: 'Subscription' })}>
      <InfoRow
        label={t('mobile.settings.currentPlan', { defaultValue: 'Current plan' })}
        value={currentPlan}
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
      {isFetching && (
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
