import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  buildProfileModelUsageRows,
  buildProfileUsageLimitViewModel,
  formatProfileCreditBalanceLabel,
  formatProfilePlanLabel,
  normalizeProfilePlan,
  type PaidProfilePlan,
} from '@taskforceai/presenters';
import { formatModelCostTier, PUBLIC_MODEL_SELECTOR_CATALOG } from '@taskforceai/client-core';

import { ActionButton } from '../../../components/ActionButton';
import { useTheme } from '../../../contexts/ThemeContext';
import { Section } from '../components';

interface UsageSubscriptionData {
  data?: {
    subscription?: {
      current_period_end: number | null;
    } | null;
  } | null;
  isFetching: boolean;
}

interface UsageBillingBalanceData {
  data?: {
    creditBalance?: number | null;
    currentPeriodEnd?: number | null;
  } | null;
  isFetching: boolean;
}

interface UsageUser {
  plan: string | null;
  message_count: number | null;
  current_period_end: string | null;
}

interface UsageSectionProps {
  user: UsageUser | null;
  billingBalanceQuery: UsageBillingBalanceData;
  subscriptionQuery: UsageSubscriptionData;
  isProcessing: boolean;
  proPriceLabel: string | null;
  superPriceLabel: string | null;
  onPurchasePlan: (_plan: PaidProfilePlan) => void;
  onManageBilling: () => void;
}

const usageSectionViewModel = (
  props: Pick<
    UsageSectionProps,
    'user' | 'billingBalanceQuery' | 'subscriptionQuery' | 'proPriceLabel' | 'superPriceLabel'
  >
) => {
  const plan = normalizeProfilePlan(props.user?.plan);
  const usage = buildProfileUsageLimitViewModel({
    plan,
    messageCount: props.user?.message_count,
    currentPeriodEnd:
      props.billingBalanceQuery.data?.currentPeriodEnd ??
      props.subscriptionQuery.data?.subscription?.current_period_end ??
      props.user?.current_period_end ??
      null,
  });
  const progressWidth =
    usage.ratio == null ? 0 : Math.max(usage.ratio * 100, usage.ratio > 0 ? 2 : 0);
  const nextPlan: PaidProfilePlan | null =
    plan === 'free' ? 'pro' : plan === 'pro' ? 'super' : null;
  const nextPlanPriceLabel =
    nextPlan === 'pro'
      ? props.proPriceLabel
      : nextPlan === 'super'
        ? props.superPriceLabel
        : null;
  return {
    plan,
    usage,
    progressWidth,
    nextPlan,
    nextPlanPriceLabel,
    creditBalanceLabel: formatProfileCreditBalanceLabel(
      props.billingBalanceQuery.data?.creditBalance
    ),
  };
};

export function UsageSection({
  user,
  billingBalanceQuery,
  subscriptionQuery,
  isProcessing,
  proPriceLabel,
  superPriceLabel,
  onPurchasePlan,
  onManageBilling,
}: UsageSectionProps) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { plan, usage, progressWidth, nextPlan, nextPlanPriceLabel, creditBalanceLabel } =
    usageSectionViewModel({
      user,
      billingBalanceQuery,
      subscriptionQuery,
      proPriceLabel,
      superPriceLabel,
    });
  const modelRows = buildProfileModelUsageRows(
    PUBLIC_MODEL_SELECTOR_CATALOG.options,
    formatModelCostTier
  );

  return (
    <View style={styles.stack}>
      <Section variant="plain">
        <View style={styles.heading}>
          <View style={styles.titleRow}>
            <Text selectable style={[styles.title, { color: theme.colors.text }]}>
              {t('mobile.profile.usageLimits', { defaultValue: 'Usage limits' })}
            </Text>
            <View style={[styles.planBadge, { borderColor: theme.colors.border }]}>
              <Text style={[styles.planBadgeText, { color: theme.colors.textMuted }]}>
                {formatProfilePlanLabel(plan)}
              </Text>
            </View>
          </View>
          <Text style={[styles.description, { color: theme.colors.textMuted }]}>
            {t('mobile.profile.usageLimitsDescription', {
              defaultValue:
                'Your plan determines how much TaskForceAI can run over time. Advanced models and generation tools can consume more usage.',
            })}
          </Text>
          <View style={styles.refreshRow}>
            <Text style={[styles.caption, { color: theme.colors.textMuted }]}>
              {t('mobile.profile.usageUpdated', {
                defaultValue: 'Usage reflects the latest loaded profile data.',
              })}
            </Text>
            {subscriptionQuery.isFetching || billingBalanceQuery.isFetching ? (
              <ActivityIndicator size="small" color={theme.colors.primary} />
            ) : null}
          </View>
        </View>
      </Section>

      <Section>
        <View style={styles.usageCard}>
          <View style={styles.usageTopRow}>
            <View style={styles.usageTitleGroup}>
              <Text selectable style={[styles.cardTitle, { color: theme.colors.text }]}>
                {usage.label}
              </Text>
              <Text selectable style={[styles.cardSubtitle, { color: theme.colors.textMuted }]}>
                {usage.description}
              </Text>
            </View>
            <Text
              selectable
              style={[
                styles.percent,
                { color: usage.tone === 'danger' ? theme.colors.error : theme.colors.text },
              ]}
            >
              {usage.percentLabel}
            </Text>
          </View>

          {usage.ratio == null ? (
            <View
              style={[
                styles.throughputBox,
                { borderColor: theme.colors.border, backgroundColor: theme.colors.inputBackground },
              ]}
            >
              <Text selectable style={[styles.throughputText, { color: theme.colors.textMuted }]}>
                {t('mobile.profile.noFixedWeeklyCap', {
                  defaultValue: 'No fixed weekly cap is shown for this plan.',
                })}
              </Text>
            </View>
          ) : (
            <View
              accessibilityLabel={usage.label}
              accessibilityRole="progressbar"
              style={[styles.progressTrack, { backgroundColor: theme.colors.inputBackground }]}
            >
              <View
                style={[
                  styles.progressFill,
                  {
                    backgroundColor:
                      usage.tone === 'danger' ? theme.colors.error : theme.colors.primary,
                    width: `${progressWidth}%`,
                  },
                ]}
              />
            </View>
          )}

          <View style={styles.usageBottomRow}>
            <Text selectable style={[styles.caption, { color: theme.colors.textMuted }]}>
              {usage.usedLabel}
            </Text>
            {usage.resetLabel ? (
              <Text selectable style={[styles.caption, { color: theme.colors.textMuted }]}>
                {usage.resetLabel}
              </Text>
            ) : null}
          </View>
        </View>

        {nextPlan ? (
          <View style={styles.upgradeRow}>
            <View style={styles.upgradeCopy}>
              <Text selectable style={[styles.rowTitle, { color: theme.colors.text }]}>
                {t('mobile.profile.getMoreUsage', {
                  defaultValue: `Get more usage with ${formatProfilePlanLabel(nextPlan)}`,
                })}
              </Text>
              <Text selectable style={[styles.caption, { color: theme.colors.textMuted }]}>
                {nextPlanPriceLabel
                  ? t('mobile.profile.billedMonthlyPrice', {
                      defaultValue: `${nextPlanPriceLabel} / month`,
                    })
                  : t('mobile.profile.priceUnavailable', { defaultValue: 'Price unavailable' })}
              </Text>
            </View>
            <ActionButton
              className="mb-0"
              disabled={isProcessing || !nextPlanPriceLabel}
              isLoading={isProcessing}
              onPress={() => onPurchasePlan(nextPlan)}
            >
              {t('mobile.profile.upgrade', { defaultValue: 'Upgrade' })}
            </ActionButton>
          </View>
        ) : (
          <View style={styles.upgradeRow}>
            <View style={styles.upgradeCopy}>
              <Text selectable style={[styles.rowTitle, { color: theme.colors.text }]}>
                {t('mobile.profile.highestPlan', { defaultValue: 'Highest usage plan' })}
              </Text>
              <Text selectable style={[styles.caption, { color: theme.colors.textMuted }]}>
                {t('mobile.profile.manageBillingForPlan', {
                  defaultValue: 'Manage or cancel your active subscription in billing settings.',
                })}
              </Text>
            </View>
            <ActionButton className="mb-0" disabled={isProcessing} onPress={onManageBilling}>
              {t('mobile.profile.manageBilling', { defaultValue: 'Manage Billing' })}
            </ActionButton>
          </View>
        )}
      </Section>

      <Section title={t('mobile.profile.modelUsageRates', { defaultValue: 'Model cost tiers' })}>
        {modelRows.map((model) => (
          <View key={model.id} style={styles.modelRow}>
            <View style={styles.modelCopy}>
              <View style={styles.modelTitleRow}>
                <Text selectable style={[styles.rowTitle, { color: theme.colors.text }]}>
                  {model.label}
                </Text>
                <View style={[styles.modelBadge, { backgroundColor: theme.colors.inputBackground }]}>
                  <Text style={[styles.modelBadgeText, { color: theme.colors.textMuted }]}>
                    {model.badge}
                  </Text>
                </View>
              </View>
              {model.description ? (
                <Text selectable style={[styles.caption, { color: theme.colors.textMuted }]}>
                  {model.description}
                </Text>
              ) : null}
            </View>
            <Text selectable style={[styles.costTier, { color: theme.colors.success }]}>
              {model.usageLabel}
            </Text>
          </View>
        ))}
      </Section>

      <Section title={t('mobile.profile.credits', { defaultValue: 'Credits' })}>
        <View style={styles.creditRow}>
          <Text selectable style={[styles.rowTitle, { color: theme.colors.text }]}>
            {t('mobile.profile.balance', { defaultValue: 'Balance' })}
          </Text>
          <Text selectable style={[styles.rowValue, { color: theme.colors.textMuted }]}>
            {creditBalanceLabel ?? '$0.00'}
          </Text>
        </View>
        <View style={styles.creditRow}>
          <Text selectable style={[styles.rowTitle, { color: theme.colors.text }]}>
            {t('mobile.profile.monthlySpendLimit', { defaultValue: 'Monthly spend limit' })}
          </Text>
          <Text selectable style={[styles.rowValue, { color: theme.colors.textMuted }]}>
            {t('mobile.profile.planIncluded', { defaultValue: 'Plan included' })}
          </Text>
        </View>
        <View style={styles.creditFooter}>
          <Text selectable style={[styles.caption, { color: theme.colors.textMuted }]}>
            {t('mobile.profile.creditsDescription', {
              defaultValue: 'Usage credits cover you when you hit your plan limits.',
            })}
          </Text>
        </View>
      </Section>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: 4,
  },
  heading: {
    gap: 8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 34,
  },
  planBadge: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  planBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
  },
  refreshRow: {
    minHeight: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  caption: {
    fontSize: 12,
    lineHeight: 17,
  },
  usageCard: {
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  usageTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  usageTitleGroup: {
    flex: 1,
    gap: 4,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  cardSubtitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  percent: {
    fontSize: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: 8,
    borderRadius: 4,
  },
  throughputBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  throughputText: {
    fontSize: 13,
    lineHeight: 18,
  },
  usageBottomRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 8,
  },
  upgradeRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  upgradeCopy: {
    flex: 1,
    gap: 4,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
  },
  rowValue: {
    fontSize: 15,
    lineHeight: 20,
    fontVariant: ['tabular-nums'],
  },
  modelRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  modelCopy: {
    flex: 1,
    gap: 5,
  },
  modelTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  modelBadge: {
    borderRadius: 9,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  modelBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  costTier: {
    minWidth: 48,
    textAlign: 'right',
    fontSize: 13,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  creditRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  creditFooter: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
});
