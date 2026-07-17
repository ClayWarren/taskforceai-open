import { cn } from '@taskforceai/ui-kit/utils';
import { Card, CardContent } from '@taskforceai/ui-kit/card';
import type { Service, ServiceStatus } from '@taskforceai/contracts/api/status';
import { UptimeBar } from './UptimeBar';

type ServiceStatusCardProps = {
  service: Service;
};

const statusBadgeConfig: Record<
  ServiceStatus,
  { label: string; bgClass: string; textClass: string }
> = {
  operational: {
    label: 'Operational',
    bgClass: 'bg-green-500/10',
    textClass: 'text-green-700 dark:text-green-400',
  },
  degraded: {
    label: 'Degraded',
    bgClass: 'bg-yellow-500/10',
    textClass: 'text-yellow-700 dark:text-yellow-400',
  },
  outage: {
    label: 'Outage',
    bgClass: 'bg-red-500/10',
    textClass: 'text-red-700 dark:text-red-400',
  },
  maintenance: {
    label: 'Maintenance',
    bgClass: 'bg-blue-500/10',
    textClass: 'text-blue-700 dark:text-blue-400',
  },
};

export function ServiceStatusCard({ service }: ServiceStatusCardProps) {
  const badgeConfig = statusBadgeConfig[service.status];

  return (
    <Card>
      <CardContent className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">{service.name}</h3>
          <div className="flex items-center gap-3">
            <span
              className={cn(
                'rounded-full px-3 py-1 text-sm font-medium',
                badgeConfig.bgClass,
                badgeConfig.textClass
              )}
            >
              {badgeConfig.label}
            </span>
          </div>
        </div>
        <UptimeBar history={service.uptimeHistory} label={`${service.name} uptime`} />
        <div className="mt-2 text-right text-sm text-muted-foreground">
          {service.uptimePercent}% uptime
        </div>
      </CardContent>
    </Card>
  );
}
