import {
  PAID_PROFILE_PLANS,
  normalizeProfilePlan,
  type PaidProfilePlan,
  type ProfilePlan,
} from '@taskforceai/client-core/product/plans';
import { formatCurrencyFromMinorUnits } from '../time/display-format';

export { normalizeProfilePlan };
export type { PaidProfilePlan, ProfilePlan };

export interface ProfileProductLike {
  id?: string;
  plan?: string | null;
  price_id?: string | null;
  price_amount?: number | null;
  price_currency?: string | null;
}

export interface ProfileUpgradeOption {
  plan: PaidProfilePlan;
  price_id: string | null;
  price_amount: number | null;
  price_currency: string;
}

export interface ProfilePlanPriceLabels {
  proPriceLabel: string | null;
  superPriceLabel: string | null;
}

export interface ProfileUsageLimitViewModel {
  label: string;
  description: string;
  usedLabel: string;
  percentLabel: string;
  resetLabel: string | null;
  ratio: number | null;
  tone: 'default' | 'danger';
}

export interface ProfileModelUsageViewModel {
  id: string;
  label: string;
  description: string | null;
  badge: string;
  usageLabel: string;
}

export interface ProfileModelUsageLike {
  id: string;
  label: string;
  badge: string;
  description?: string | null;
  usageMultiple?: number | null;
}

const PLAN_THROUGHPUT_LABELS: Record<ProfilePlan, string> = {
  free: '1 message per week',
  pro: '2 messages per hour',
  super: '20 messages per hour',
};

export const normalizeProfileFullName = (fullName: string | null | undefined): string =>
  fullName?.trim() ?? '';

export const inferDisplayNameFromEmail = (email: string | null | undefined): string => {
  if (!email) {
    return '';
  }

  return (email.split('@')[0] ?? '')
    .split(/[._-]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

export const resolveProfileDisplayName = ({
  fullName,
  email,
  fallback = 'Not set',
}: {
  fullName?: string | null;
  email?: string | null;
  fallback?: string;
}): string => normalizeProfileFullName(fullName) || inferDisplayNameFromEmail(email) || fallback;

export const resolveProfileInitials = ({
  fullName,
  email,
  fallback = 'TF',
}: {
  fullName?: string | null;
  email?: string | null;
  fallback?: string;
}): string => {
  const source =
    normalizeProfileFullName(fullName) || inferDisplayNameFromEmail(email) || email || fallback;
  const initials = source
    .split(' ')
    .map((part) => part.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return initials || fallback;
};

export const resolveProfileHandle = (
  email: string | null | undefined,
  fallback = '@taskforce'
): string => (email ? `@${email.split('@')[0]}` : fallback);

export const formatProfilePlanLabel = (plan: string | null | undefined): string => {
  const normalized = normalizeProfilePlan(plan);
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

export const resolveProfileMessageUsageLabel = ({
  plan,
  messageCount,
  freeWeeklyAllowance = 1,
}: {
  plan: string | null | undefined;
  messageCount?: number | null;
  freeWeeklyAllowance?: number;
}): string => {
  const normalized = normalizeProfilePlan(plan);
  const usedMessages = Math.max(0, messageCount ?? 0);
  if (normalized === 'free') {
    const remainingMessages = Math.max(0, freeWeeklyAllowance - usedMessages);
    return `${usedMessages} used · ${remainingMessages} remaining this week`;
  }
  const throughput = normalized === 'super' ? '20 per hour' : '2 per hour';
  return `${usedMessages} used · ${throughput}`;
};

export const resolveProfilePlanThroughputLabel = (plan: string | null | undefined): string =>
  PLAN_THROUGHPUT_LABELS[normalizeProfilePlan(plan)];

export type ProfileUsagePeriod = {
  currentPeriodStart?: number | string | null;
  currentPeriodEnd?: number | string | null;
};

export const formatProfileCreditBalanceLabel = (
  creditBalance: number | null | undefined,
  currency = 'USD'
): string | null => {
  if (typeof creditBalance !== 'number' || !Number.isFinite(creditBalance)) {
    return null;
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(creditBalance);
};

const toPeriodDate = (value: number | string | null | undefined): Date | null => {
  if (value == null) return null;
  const timestamp =
    typeof value === 'number'
      ? value * (Math.abs(value) >= 1_000_000_000_000 ? 1 : 1000)
      : Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp);
};

export const formatProfileUsageResetLabel = (
  period: ProfileUsagePeriod | null | undefined,
  locale = 'en-US'
): string | null => {
  const endDate = toPeriodDate(period?.currentPeriodEnd);
  if (!endDate) return null;

  return `Resets ${endDate.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`;
};

const clampUsageRatio = (value: number): number => Math.min(1, Math.max(0, value));

export const buildProfileUsageLimitViewModel = ({
  plan,
  messageCount,
  currentPeriodEnd,
  freeWeeklyAllowance = 1,
  locale = 'en-US',
}: {
  plan: string | null | undefined;
  messageCount?: number | null;
  currentPeriodEnd?: number | string | null;
  freeWeeklyAllowance?: number;
  locale?: string;
}): ProfileUsageLimitViewModel => {
  const normalized = normalizeProfilePlan(plan);
  const usedMessages = Math.max(0, messageCount ?? 0);
  const resetLabel = formatProfileUsageResetLabel({ currentPeriodEnd }, locale);

  if (normalized === 'free') {
    const limit = Math.max(1, freeWeeklyAllowance);
    const ratio = clampUsageRatio(usedMessages / limit);
    const usedPercent = Math.round(ratio * 100);
    return {
      label: 'Weekly messages',
      description: `${limit.toLocaleString(locale)} message${limit === 1 ? '' : 's'} per week`,
      usedLabel: `${usedMessages.toLocaleString(locale)} of ${limit.toLocaleString(locale)} used`,
      percentLabel: `${usedPercent}% used`,
      resetLabel: resetLabel ?? 'Resets weekly',
      ratio,
      tone: usedMessages >= limit ? 'danger' : 'default',
    };
  }

  const messageLabel = usedMessages === 1 ? 'message' : 'messages';

  return {
    label: 'Plan throughput',
    description: PLAN_THROUGHPUT_LABELS[normalized],
    usedLabel: `${usedMessages.toLocaleString(locale)} ${messageLabel} used`,
    percentLabel: 'Metered by throughput',
    resetLabel,
    ratio: null,
    tone: 'default',
  };
};

export const buildProfileModelUsageRows = (
  options: ProfileModelUsageLike[],
  formatUsage: (_value?: number) => string | null
): ProfileModelUsageViewModel[] =>
  options.map((option) => ({
    id: option.id,
    label: option.label,
    description: option.description?.trim() || null,
    badge: option.badge,
    usageLabel: formatUsage(option.usageMultiple ?? undefined) ?? 'Standard',
  }));

const findProductForPlan = (
  products: ProfileProductLike[],
  plan: PaidProfilePlan
): ProfileProductLike | undefined =>
  products.find((product) => product.plan === plan) ??
  products.find((product) => product.id?.toLowerCase().includes(plan));

export const buildProfileUpgradeOptions = ({
  currentPlan,
  products,
}: {
  currentPlan: string | null | undefined;
  products: ProfileProductLike[];
}): ProfileUpgradeOption[] => {
  const plan = normalizeProfilePlan(currentPlan);
  if (plan === 'super') {
    return [];
  }

  return PAID_PROFILE_PLANS.filter((planKey) => planKey !== plan).map((planKey) => {
    const product = findProductForPlan(products, planKey);
    return {
      plan: planKey,
      price_id: product?.price_id ?? null,
      price_amount: product?.price_amount ?? null,
      price_currency: product?.price_currency ?? 'USD',
    };
  });
};

export const formatProfilePriceLabel = ({
  plan,
  amount,
  currency = 'USD',
  defaultPriceByPlan = { pro: 2800, super: 28000 },
}: {
  plan: PaidProfilePlan;
  amount?: number | null;
  currency?: string | null;
  defaultPriceByPlan?: Record<PaidProfilePlan, number>;
}): string => {
  const cents =
    typeof amount === 'number' && Number.isFinite(amount) ? amount : defaultPriceByPlan[plan];
  return `${formatCurrencyFromMinorUnits(cents, currency ?? 'USD')} / month`;
};

export const resolveProfilePlanPriceLabels = (
  products: ProfileProductLike[] | null | undefined,
  formatPrice: (amount: number, currency: string) => string = formatCurrencyFromMinorUnits
): ProfilePlanPriceLabels => {
  const productList = products ?? [];
  const proProduct = findProductForPlan(productList, 'pro') ?? productList[0];
  const superProduct = findProductForPlan(productList, 'super');

  return {
    proPriceLabel:
      proProduct && proProduct.price_amount != null
        ? formatPrice(proProduct.price_amount, proProduct.price_currency ?? 'USD')
        : null,
    superPriceLabel:
      superProduct && superProduct.price_amount != null
        ? formatPrice(superProduct.price_amount, superProduct.price_currency ?? 'USD')
        : null,
  };
};

export const formatSubscriptionSourceLabel = (
  source: string | null | undefined,
  labels: Partial<Record<'stripe' | 'app_store' | 'play_store' | 'fallback', string>> = {}
): string | null => {
  if (!source) {
    return labels.fallback ?? null;
  }
  if (source === 'stripe') {
    return labels.stripe ?? 'Stripe (Web/Desktop)';
  }
  if (source === 'app_store') {
    return labels.app_store ?? 'Apple App Store';
  }
  if (source === 'play_store') {
    return labels.play_store ?? 'Google Play Store';
  }
  return labels.fallback ?? null;
};
