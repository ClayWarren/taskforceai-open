import { type KeyboardEvent, useRef, useState } from 'react';

import { cn } from '@taskforceai/ui-kit/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@taskforceai/ui-kit/tooltip';

import type { DayStatus, ServiceStatus } from '@taskforceai/contracts/api/status';
import { parseStatusDate } from './date-utils';

type UptimeBarProps = {
  history: DayStatus[];
  label?: string;
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

function formatHistoryEndpointLabel(
  history: DayStatus[],
  index: number,
  invalidLabel: string
): string {
  if (history.length === 0) {
    return '';
  }

  const day = history.at(index);
  // coverage-ignore-next-line -- guarded by history.length above; retained for defensive callers.
  if (!day) {
    return ''; // coverage-ignore-line
  }

  const date = parseStatusDate(day.date);
  if (!date) {
    return invalidLabel;
  }

  if (isSameUtcDay(date, new Date())) {
    return 'Today';
  }

  return formatUptimeDate(day.date);
}

function isSameUtcDay(left: Date, right: Date): boolean {
  return (
    left.getUTCFullYear() === right.getUTCFullYear() &&
    left.getUTCMonth() === right.getUTCMonth() &&
    left.getUTCDate() === right.getUTCDate()
  );
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

export function UptimeBar({ history, label = 'Uptime' }: UptimeBarProps) {
  // If we have less than 90 days, we'll show what we have.
  // The flex-1 will make the bars expand to fill space.
  const latestIndex = Math.max(history.length - 1, 0);
  const [activeIndex, setActiveIndex] = useState(latestIndex);
  const cellRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const tabbableIndex = activeIndex < history.length ? activeIndex : latestIndex;

  const focusCell = (index: number) => {
    setActiveIndex(index);
    cellRefs.current[index]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number;

    switch (event.key) {
      case 'ArrowLeft':
        nextIndex = Math.max(0, index - 1);
        break;
      case 'ArrowRight':
        nextIndex = Math.min(history.length - 1, index + 1);
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = history.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    focusCell(nextIndex);
  };

  return (
    <div className="w-full">
      <div
        aria-label={`${label}: ${history.length}-day history. Use left and right arrow keys to review days.`}
        className="flex gap-[2px]"
        role="group"
      >
        {history.map((day, index) => {
          const statusMessage =
            day.message ||
            (day.status === 'operational' ? 'No incidents reported' : statusLabels[day.status]);

          return (
            <Tooltip key={`${day.date}-${index}`}>
              <TooltipTrigger asChild>
                <button
                  aria-label={`${day.date}: ${statusLabels[day.status]}. ${statusMessage}`}
                  className={cn(
                    'relative h-8 flex-1 cursor-default rounded-sm border-0 p-0 transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none',
                    statusColors[day.status]
                  )}
                  data-uptime-cell
                  onFocus={() => setActiveIndex(index)}
                  onKeyDown={(event) => handleKeyDown(event, index)}
                  ref={(element) => {
                    cellRefs.current[index] = element;
                  }}
                  tabIndex={index === tabbableIndex ? 0 : -1}
                  type="button"
                />
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
        <span>{formatHistoryEndpointLabel(history, 0, 'Start')}</span>
        <span>{formatHistoryEndpointLabel(history, -1, 'Latest')}</span>
      </div>
    </div>
  );
}
