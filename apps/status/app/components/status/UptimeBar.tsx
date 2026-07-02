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

function formatHistoryStartLabel(history: DayStatus[]): string {
  if (history.length === 0) {
    return '';
  }

  const first = history[0];
  // coverage-ignore-next-line -- guarded by history.length above; retained for defensive callers.
  if (!first) {
    return ''; // coverage-ignore-line
  }

  const firstDate = parseStatusDate(first.date);
  if (!firstDate) {
    return 'Start';
  }

  if (isSameUtcDay(firstDate, new Date())) {
    return 'Today';
  }

  return formatUptimeDate(first.date);
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
  // coverage-ignore-next-line -- guarded by history.length above; retained for defensive callers.
  if (!last) {
    return ''; // coverage-ignore-line
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
        {history.map((day, index) => {
          const statusMessage =
            day.message ||
            (day.status === 'operational' ? 'No incidents reported' : statusLabels[day.status]);

          return (
            <Tooltip key={`${day.date}-${index}`}>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    'group relative h-8 flex-1 cursor-default rounded-sm transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none',
                    statusColors[day.status]
                  )}
                  role="img"
                  tabIndex={0}
                  aria-label={`${day.date}: ${statusLabels[day.status]}. ${statusMessage}`}
                >
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 rounded-md bg-primary px-3 py-1.5 text-xs whitespace-nowrap text-primary-foreground shadow-sm group-focus-visible:block"
                  >
                    {statusMessage}
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="top">
                <div className="text-center">
                  <p className="font-medium">{formatUptimeDate(day.date)}</p>
                  <p className="text-muted-foreground">{statusMessage}</p>
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-xs text-muted-foreground">
        <span>{formatHistoryStartLabel(history)}</span>
        <span>{formatHistoryEndLabel(history)}</span>
      </div>
    </div>
  );
}
