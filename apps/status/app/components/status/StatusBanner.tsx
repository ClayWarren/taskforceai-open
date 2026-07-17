import { cn } from '@taskforceai/ui-kit/utils';

import type { ServiceStatus } from '@taskforceai/contracts/api/status';

type StatusBannerProps = {
  status: ServiceStatus;
};

const statusConfig: Record<
  ServiceStatus,
  { label: string; icon: string; bgClass: string; textClass: string }
> = {
  operational: {
    label: 'All Systems Operational',
    icon: '\u2713',
    bgClass: 'bg-green-500/10 border-green-500/20',
    textClass: 'text-green-700 dark:text-green-400',
  },
  degraded: {
    label: 'Partial System Outage',
    icon: '!',
    bgClass: 'bg-yellow-500/10 border-yellow-500/20',
    textClass: 'text-yellow-700 dark:text-yellow-400',
  },
  outage: {
    label: 'Major System Outage',
    icon: '\u2717',
    bgClass: 'bg-red-500/10 border-red-500/20',
    textClass: 'text-red-700 dark:text-red-400',
  },
  maintenance: {
    label: 'Scheduled Maintenance',
    icon: '\u2699',
    bgClass: 'bg-blue-500/10 border-blue-500/20',
    textClass: 'text-blue-700 dark:text-blue-400',
  },
};

export function StatusBanner({ status }: StatusBannerProps) {
  const config = statusConfig[status];

  return (
    <div
      className={cn('flex items-center justify-center gap-3 rounded-lg border p-4', config.bgClass)}
    >
      <span
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-full text-lg font-bold',
          config.textClass,
          status === 'operational' && 'bg-green-500/20',
          status === 'degraded' && 'bg-yellow-500/20',
          status === 'outage' && 'bg-red-500/20',
          status === 'maintenance' && 'bg-blue-500/20'
        )}
      >
        {config.icon}
      </span>
      <span className={cn('text-lg font-semibold', config.textClass)}>{config.label}</span>
    </div>
  );
}
