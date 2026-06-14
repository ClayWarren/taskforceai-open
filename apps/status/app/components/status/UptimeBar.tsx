import { cn } from '../../lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';

import type { DayStatus, ServiceStatus } from './types';
import { parseStatusDate } from './date-utils';

type UptimeBarProps = {
  history: DayStatus[];
};

const statusColors: Record<ServiceStatus, string> = {
  operational: 'bg-green-500',
  degraded: 'bg-yellow-500',
  outage: 'bg-red-500',
  maintenance: 'bg-blue-500',
};

const statusLabels: Record<ServiceStatus, string> = {
  operational: 'Operational',
  degraded: 'Degraded Performance',
  outage: 'Service Outage',
  maintenance: 'Maintenance',
};

function formatHistoryStartLabel(historyLength: number): string {
  if (historyLength === 0) {
    return '';
  }

  const daysAgo = historyLength - 1;
  if (daysAgo === 0) {
    return 'Today';
  }

  if (daysAgo === 1) {
    return '1 day ago';
  }

  return `${daysAgo} days ago`;
}

function isSameUtcDay(left: Date, right: Date): boolean {
  return (
    left.getUTCFullYear() === right.getUTCFullYear() &&
    left.getUTCMonth() === right.getUTCMonth() &&
    left.getUTCDate() === right.getUTCDate()
  );
}

function formatHistoryEndLabel(history: DayStatus[]): string {
  if (history.length === 0) {
    return '';
  }

  const last = history[history.length - 1];
  if (!last) {
    return '';
  }

  const lastDate = parseStatusDate(last.date);
  if (!lastDate) {
    return 'Latest';
  }

  if (isSameUtcDay(lastDate, new Date())) {
    return 'Today';
  }

  return formatUptimeDate(last.date);
}

export function formatUptimeDate(dateString: string, locale?: Intl.LocalesArgument): string {
  const date = parseStatusDate(dateString);
  if (!date) {
    return 'Invalid Date';
  }

  return date.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function UptimeBar({ history }: UptimeBarProps) {
  // If we have less than 90 days, we'll show what we have.
  // The flex-1 will make the bars expand to fill space.

  return (
    <div className="w-full">
      <div className="flex gap-[2px]">
        {history.map((day, index) => (
          <Tooltip key={`${day.date}-${index}`}>
            <TooltipTrigger asChild>
              <div
                className={cn(
                  'h-8 flex-1 rounded-sm transition-opacity hover:opacity-80 cursor-default',
                  statusColors[day.status]
                )}
                role="img"
                aria-label={`${day.date}: ${day.status}`}
              />
            </TooltipTrigger>
            <TooltipContent side="top">
              <div className="text-center">
                <p className="font-medium">{formatUptimeDate(day.date)}</p>
                <p className="text-muted-foreground">
                  {day.message ||
                    (day.status === 'operational'
                      ? 'No incidents reported'
                      : statusLabels[day.status])}
                </p>
              </div>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-xs text-muted-foreground">
        <span>{formatHistoryStartLabel(history.length)}</span>
        <span>{formatHistoryEndLabel(history)}</span>
      </div>
    </div>
  );
}
