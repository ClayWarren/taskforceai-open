import {
  formatLongDateOrFallback,
} from '@taskforceai/presenters/time/display-format';

export const formatUnixDate = (timestamp: number | null): string =>
  formatLongDateOrFallback(timestamp, { unixSeconds: true });

export const formatDate = (dateString: string | null): string =>
  formatLongDateOrFallback(dateString);
