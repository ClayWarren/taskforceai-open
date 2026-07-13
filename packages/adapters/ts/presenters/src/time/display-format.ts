export type TimestampInput = number | string | Date | null | undefined;

const coerceDate = (timestamp: TimestampInput): Date | null => {
  const date = new Date(timestamp as number | string | Date);
  return Number.isFinite(date.getTime()) ? date : null;
};

export const formatMessageTime = (timestamp: TimestampInput, locale?: string): string => {
  const date = coerceDate(timestamp);
  if (!date) {
    return '';
  }

  return date.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
};

export const formatMessageDate = (timestamp: TimestampInput, locale?: string): string => {
  const date = coerceDate(timestamp);
  if (!date) {
    return '';
  }

  return date.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

export const formatLongDateOrFallback = (
  value: number | string | null | undefined,
  options: { unixSeconds?: boolean; locale?: string; fallback?: string } = {}
): string => {
  if (!value) {
    return options.fallback ?? 'N/A';
  }

  const date =
    options.unixSeconds && typeof value === 'number' ? new Date(value * 1000) : coerceDate(value);
  if (!date) {
    return options.fallback ?? 'N/A';
  }

  return date.toLocaleDateString(options.locale ?? 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

export const formatDisplaySource = (source: string | null | undefined): string => {
  if (!source) {
    return 'N/A';
  }
  return source.charAt(0).toUpperCase() + source.slice(1);
};

export const formatCurrencyFromMinorUnits = (
  amount: number,
  currency = 'USD',
  locale = 'en-US'
): string =>
  new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(amount / 100);

export const formatRecentDayLabel = (
  timestamp: number,
  nowMs = Date.now(),
  locale?: string
): string => {
  const diffDays = Math.floor((nowMs - timestamp) / 86_400_000);
  if (diffDays <= 0) {
    return 'Today';
  }
  if (diffDays === 1) {
    return 'Yesterday';
  }
  if (diffDays < 7) {
    return `${diffDays} days ago`;
  }
  return new Date(timestamp).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
};

export const formatRelativeSyncTime = (timestamp: number, nowMs = Date.now()): string => {
  const diffMs = nowMs - timestamp;
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (seconds < 60) {
    return 'Just now';
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return new Date(timestamp).toLocaleDateString();
};
